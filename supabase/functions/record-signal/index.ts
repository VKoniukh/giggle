// ============================================================================
// Edge Function: record-signal
// Version: 1.0.0
// Source: docs/06_EDGE_FUNCTIONS_AND_AI.md §2 — record-signal
//
// Main fast-loop function. Does NOT call GPT.
// Must respond in <100ms.
//
// Steps:
//   1. Record immutable event
//   2. Compute signal_vector
//   3. Execute bounded tactical update (heat/fatigue/novelty_debt)
//   4. Update session rhythm_state
//   5. If needed → create reflect/compose ai_run
//   6. Select next ready card (same logic as next-card)
//   7. Return next card
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createServiceClient,
  getUserIdFromAuth,
  corsHeaders,
} from '../_shared/supabase-client.ts';
import {
  HEAT_DELTA_HEART,
  FATIGUE_DELTA_HEART,
  NOVELTY_DEBT_DELTA_HEART,
  HEAT_DELTA_SKIP,
  HEAT_DELTA_SHARE,
  FATIGUE_THRESHOLD_RESTING,
  REFLECTION_TRIGGER_HEARTS_IN_5,
  REFLECTION_TRIGGER_CARDS_SINCE,
  COMPOSE_TRIGGER_FRONTIER_MIN,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from '../_shared/constants.ts';
import type { EventType, SignalVector } from '../_shared/types.ts';

interface RecordSignalRequest {
  session_id: string;
  card_id: string;
  event_type: EventType;
  dwell_ms?: number;
  estimated_read_ratio?: number;
  position?: number;
  metadata?: Record<string, unknown>;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = await getUserIdFromAuth(authHeader);
    const supabase = createServiceClient();
    const body: RecordSignalRequest = await req.json();

    const { session_id, card_id, event_type, dwell_ms, estimated_read_ratio, position, metadata } = body;

    // ─── Step 1: Record immutable event ─────────────────────────────────
    // docs/05 §5: "Events НІКОЛИ не редагуються AI"

    const signalVector = computeSignalVector(event_type, dwell_ms, estimated_read_ratio);

    const { error: eventError } = await supabase
      .from('events')
      .insert({
        user_id: userId,
        session_id,
        card_id,
        event_type,
        dwell_ms: dwell_ms || null,
        estimated_read_ratio: estimated_read_ratio || null,
        position: position || null,
        signal_vector: signalVector,
        metadata: metadata || null,
      });

    if (eventError) {
      throw new Error(`Failed to record event: ${eventError.message}`);
    }

    // ─── Step 2: Get card info for tactical update ──────────────────────
    const { data: card } = await supabase
      .from('cards')
      .select('id, source_thread_ids, move, recipe, format')
      .eq('id', card_id)
      .single();

    // ─── Step 3: Tactical update (deterministic, no GPT) ────────────────
    // docs/06 §record-signal: "Bounded tactical update"

    if (event_type === 'heart') {
      // ── Heart: the strongest explicit signal ──
      // Update card status to 'hearted' (auto-save to Personal Canon)
      await supabase
        .from('cards')
        .update({
          status: 'hearted',
          quality_state: 'canon_candidate',
        })
        .eq('id', card_id);

      // Update source threads: heat ↑, fatigue ↑
      if (card?.source_thread_ids?.length) {
        for (const threadId of card.source_thread_ids) {
          await updateThreadTactical(supabase, threadId, {
            heat_delta: HEAT_DELTA_HEART,
            fatigue_delta: FATIGUE_DELTA_HEART,
            add_positive_evidence: card_id,
          });
        }
      }

      // Update session
      await updateSessionAfterSignal(supabase, session_id, {
        strong_signal: true,
        novelty_debt_delta: NOVELTY_DEBT_DELTA_HEART,
        move: card?.move,
        thread_ids: card?.source_thread_ids,
        format: card?.format || card?.recipe?.format,
      });

    } else if (event_type === 'share') {
      // ── Share: separate axis, social utility signal ──
      // docs/06: "do NOT automatically increase comic confidence same as heart"
      if (card?.source_thread_ids?.length) {
        for (const threadId of card.source_thread_ids) {
          await updateThreadTactical(supabase, threadId, {
            heat_delta: HEAT_DELTA_SHARE,
            fatigue_delta: 0,
          });
        }
      }

      await updateSessionAfterSignal(supabase, session_id, {
        strong_signal: true,
        novelty_debt_delta: 0,
        move: card?.move,
        thread_ids: card?.source_thread_ids,
        format: card?.format || card?.recipe?.format,
      });

    } else if (event_type === 'skip') {
      // ── Skip: small local penalty, no immediate thread destruction ──
      // docs/06: "increase penalty only after repeated related skips"
      if (card?.source_thread_ids?.length) {
        for (const threadId of card.source_thread_ids) {
          await updateThreadTactical(supabase, threadId, {
            heat_delta: HEAT_DELTA_SKIP,
            fatigue_delta: 0,
          });
        }
      }

      await updateSessionAfterSignal(supabase, session_id, {
        strong_signal: false,
        novelty_debt_delta: 0,
        move: card?.move,
        thread_ids: card?.source_thread_ids,
        format: card?.format || card?.recipe?.format,
      });

    } else if (event_type === 'back') {
      // ── Back/reread: slow burn indicator ──
      // No immediate tactical change, but recorded for reflection
      await updateSessionAfterSignal(supabase, session_id, {
        strong_signal: false,
        novelty_debt_delta: 0,
        move: card?.move,
        thread_ids: card?.source_thread_ids,
        format: card?.format || card?.recipe?.format,
      });
    }

    // ─── Step 4: Check if reflection/composition needed ─────────────────
    const triggerResult = await checkTriggers(supabase, userId, session_id, event_type);

    // ─── Step 5: Select next ready card ─────────────────────────────────
    const nextCard = await selectNextCard(supabase, userId, session_id);

    // ─── Step 6: Return response ────────────────────────────────────────
    return new Response(
      JSON.stringify({
        next_card: nextCard,
        triggers_fired: triggerResult,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('record-signal error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: error instanceof Error && error.message === 'Unauthorized' ? 401 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════════

function computeSignalVector(
  eventType: EventType,
  dwellMs?: number,
  readRatio?: number,
): SignalVector {
  // docs/03 §Signal Vector: attention, mirth, identity_resonance,
  //   social_utility, rejection, slow_burn_probability
  const attention = readRatio || (dwellMs ? Math.min(dwellMs / 5000, 1.0) : 0.5);

  switch (eventType) {
    case 'heart':
      return {
        attention,
        mirth: 1.0,
        identity_resonance: attention > 0.7 ? 0.5 : 0.2,
        social_utility: 0.0,
        rejection: 0.0,
        slow_burn_probability: 0.0,
      };
    case 'share':
      return {
        attention,
        mirth: 0.7,
        identity_resonance: 0.1,
        social_utility: 1.0,
        rejection: 0.0,
        slow_burn_probability: 0.0,
      };
    case 'skip':
      return {
        attention: Math.min(attention, 0.3),
        mirth: 0.0,
        identity_resonance: 0.0,
        social_utility: 0.0,
        rejection: attention < 0.2 ? 0.5 : 0.2,
        slow_burn_probability: 0.0,
      };
    case 'back':
      return {
        attention: 0.8,
        mirth: 0.3,
        identity_resonance: 0.3,
        social_utility: 0.0,
        rejection: 0.0,
        slow_burn_probability: 0.7,
      };
    default:
      return {
        attention: 0.5,
        mirth: 0.0,
        identity_resonance: 0.0,
        social_utility: 0.0,
        rejection: 0.0,
        slow_burn_probability: 0.0,
      };
  }
}


async function updateThreadTactical(
  supabase: ReturnType<typeof createServiceClient>,
  threadId: string,
  updates: {
    heat_delta: number;
    fatigue_delta: number;
    add_positive_evidence?: string;
  }
) {
  // Read current thread state
  const { data: thread } = await supabase
    .from('threads')
    .select('heat, fatigue, status, positive_evidence')
    .eq('id', threadId)
    .single();

  if (!thread) return;

  const newHeat = Math.max(0, Math.min(1, thread.heat + updates.heat_delta));
  const newFatigue = Math.max(0, Math.min(1, thread.fatigue + updates.fatigue_delta));

  // docs/05 §3: Thread status transitions
  // If fatigue > threshold → resting
  let newStatus = thread.status;
  if (newFatigue > FATIGUE_THRESHOLD_RESTING && thread.status === 'active') {
    newStatus = 'resting';
  }

  const updateObj: Record<string, unknown> = {
    heat: newHeat,
    fatigue: newFatigue,
    status: newStatus,
    last_used_at: new Date().toISOString(),
  };

  // Add positive evidence if heart
  if (updates.add_positive_evidence) {
    const evidence = [...(thread.positive_evidence || []), updates.add_positive_evidence];
    updateObj.positive_evidence = evidence;
  }

  await supabase
    .from('threads')
    .update(updateObj)
    .eq('id', threadId);
}


async function updateSessionAfterSignal(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
  updates: {
    strong_signal: boolean;
    novelty_debt_delta: number;
    move?: string;
    thread_ids?: string[];
    format?: string;
  }
) {
  const { data: session } = await supabase
    .from('sessions')
    .select('rhythm_state, cards_shown, strong_signals, cards_since_reflection')
    .eq('id', sessionId)
    .single();

  if (!session) return;

  const rhythm = session.rhythm_state || {};

  // Update recent moves & threads (keep last 10)
  const recentMoves = [...(rhythm.recent_moves || []), updates.move].slice(-10);
  const recentThreadIds = [
    ...(rhythm.recent_thread_ids || []),
    ...(updates.thread_ids || []),
  ].slice(-10);
  const formatsUsed = [
    ...(rhythm.formats_recently_used || []),
    updates.format,
  ].filter(Boolean).slice(-5);

  const updatedRhythm = {
    ...rhythm,
    recent_moves: recentMoves,
    recent_thread_ids: recentThreadIds,
    formats_recently_used: formatsUsed,
    novelty_debt: Math.max(0, (rhythm.novelty_debt || 0) + updates.novelty_debt_delta),
  };

  await supabase
    .from('sessions')
    .update({
      rhythm_state: updatedRhythm,
      cards_shown: session.cards_shown + 1,
      strong_signals: session.strong_signals + (updates.strong_signal ? 1 : 0),
      cards_since_reflection: session.cards_since_reflection + 1,
    })
    .eq('id', sessionId);
}


async function checkTriggers(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  sessionId: string,
  eventType: EventType,
): Promise<string[]> {
  const triggered: string[] = [];
  const { data: session } = await supabase
    .from('sessions')
    .select('cards_shown, strong_signals, cards_since_reflection, rhythm_state')
    .eq('id', sessionId)
    .single();

  if (!session) return triggered;

  // ── Reflection triggers (docs/06 §Trigger Conditions) ──
  const needsReflection =
    eventType === 'heart' ||
    eventType === 'share' ||
    session.cards_since_reflection >= REFLECTION_TRIGGER_CARDS_SINCE;

  if (needsReflection) {
    const { error } = await supabase.from('ai_runs').insert({
      user_id: userId,
      session_id: sessionId,
      run_type: 'reflect',
      status: 'queued',
      trigger_reason: eventType === 'heart'
        ? 'heart_signal'
        : eventType === 'share'
          ? 'share_signal'
          : `cards_since_reflection=${session.cards_since_reflection}`,
      prompt_version: PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
    });
    if (!error) {
      triggered.push('reflect');
      // Reset cards_since_reflection
      await supabase
        .from('sessions')
        .update({ cards_since_reflection: 0 })
        .eq('id', sessionId);
    }
  }

  // ── Composition trigger: frontier < MIN ──
  const { count: frontierCount } = await supabase
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'queued');

  if ((frontierCount || 0) < COMPOSE_TRIGGER_FRONTIER_MIN) {
    const { error } = await supabase.from('ai_runs').insert({
      user_id: userId,
      session_id: sessionId,
      run_type: 'compose',
      status: 'queued',
      trigger_reason: `frontier_size=${frontierCount}`,
      prompt_version: PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
    });
    if (!error) triggered.push('compose');
  }

  return triggered;
}


async function selectNextCard(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  // docs/06 §next-card: "Знайти найкращу queued card"
  // For MVP: simple priority-based selection with basic constraint checks
  // Full card_score formula is Phase 5 polish

  const { data: candidates } = await supabase
    .from('cards')
    .select('id, text, format, move, recipe, queue_priority, source_thread_ids')
    .eq('user_id', userId)
    .eq('status', 'queued')
    .order('queue_priority', { ascending: false })
    .limit(5);

  if (!candidates || candidates.length === 0) {
    return null;
  }

  // For MVP: pick the highest priority card
  // Phase 5 will add full scoring + hard constraint validation
  const selected = candidates[0];

  // Mark as shown + create impression event
  const now = new Date().toISOString();

  await supabase
    .from('cards')
    .update({ status: 'shown', shown_at: now })
    .eq('id', selected.id);

  await supabase
    .from('events')
    .insert({
      user_id: userId,
      session_id: sessionId,
      card_id: selected.id,
      event_type: 'impression',
    });

  return {
    id: selected.id,
    text: selected.text,
    format: selected.format,
    move: selected.move,
  };
}
