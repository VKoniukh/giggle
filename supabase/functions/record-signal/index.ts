// ============================================================================
// Edge Function: record-signal
// Version: 2.0.0
// Source: docs/06_EDGE_FUNCTIONS_AND_AI.md §2 — record-signal
//         docs/04_ORCHESTRATION.md — tactical loop, hard constraints
//
// Main fast-loop function. Does NOT call GPT.
//
// Event model (v2):
//   impression        — client reports the card became VISIBLE.
//                       delivered → shown, rhythm update, novelty repayment.
//                       This is what makes shown_at / sequence honest.
//   skip/heart/share/back — reactions. Thread tactical update, triggers,
//                       next card selection via the shared orchestrator.
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
  HEAT_THRESHOLD_RETIRED,
  CONFIDENCE_THRESHOLD_RETIRED,
  REFLECTION_TRIGGER_CARDS_SINCE,
  COMPOSE_TRIGGER_FRONTIER_MIN,
  NOVELTY_REPAYMENT,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from '../_shared/constants.ts';
import { selectAndDeliverCard, queueAiRun } from '../_shared/orchestrator.ts';
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

    const { error: eventError } = await supabase.from('events').insert({
      user_id: userId,
      session_id,
      card_id,
      event_type,
      dwell_ms: dwell_ms || null,
      estimated_read_ratio: estimated_read_ratio || null,
      position: position ?? null,
      signal_vector: event_type === 'impression' ? null : signalVector,
      metadata: metadata || null,
    });
    if (eventError) throw new Error(`Failed to record event: ${eventError.message}`);

    // ─── Step 2: Card info for tactical updates ─────────────────────────
    const { data: card } = await supabase
      .from('cards')
      .select('id, source_thread_ids, move, recipe, format, status')
      .eq('id', card_id)
      .single();

    // ═══════════════════════════════════════════════════════════════════
    // IMPRESSION — the card was actually SEEN. Rhythm lives here.
    // ═══════════════════════════════════════════════════════════════════
    if (event_type === 'impression') {
      await supabase
        .from('cards')
        .update({ status: 'shown', shown_at: new Date().toISOString() })
        .eq('id', card_id)
        .in('status', ['delivered', 'queued']); // never demote hearted

      await updateRhythmOnImpression(supabase, session_id, card);

      // Callback shown → wake the thread, decay its fatigue
      if (card?.move === 'callback' && card.source_thread_ids?.length) {
        for (const threadId of card.source_thread_ids) {
          const { data: t } = await supabase
            .from('threads').select('fatigue').eq('id', threadId).single();
          if (t) {
            await supabase.from('threads').update({
              status: 'active',
              fatigue: Math.max(0, t.fatigue * 0.5),
              last_used_at: new Date().toISOString(),
            }).eq('id', threadId);
          }
        }
      }

      return new Response(
        JSON.stringify({ ok: true, next_card: null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // REACTIONS — tactical updates (deterministic, no GPT)
    // ═══════════════════════════════════════════════════════════════════

    if (event_type === 'heart') {
      // Heart = strongest explicit signal → auto-save to Personal Canon
      await supabase
        .from('cards')
        .update({ status: 'hearted', quality_state: 'canon_candidate' })
        .eq('id', card_id);

      if (card?.source_thread_ids?.length) {
        for (const threadId of card.source_thread_ids) {
          await updateThreadTactical(supabase, threadId, {
            heat_delta: HEAT_DELTA_HEART,
            fatigue_delta: FATIGUE_DELTA_HEART,
            add_positive_evidence: card_id,
            confirm_hypothesis: true, // candidate → active
          });
        }
      }
      await updateSessionAfterReaction(supabase, session_id, {
        strong_signal: true,
        novelty_debt_delta: NOVELTY_DEBT_DELTA_HEART,
      });

    } else if (event_type === 'share') {
      // docs/06: separate axis — NOT automatically same confidence as heart
      if (card?.source_thread_ids?.length) {
        for (const threadId of card.source_thread_ids) {
          await updateThreadTactical(supabase, threadId, {
            heat_delta: HEAT_DELTA_SHARE,
            fatigue_delta: 0,
          });
        }
      }
      await updateSessionAfterReaction(supabase, session_id, {
        strong_signal: true,
        novelty_debt_delta: 0,
      });

    } else if (event_type === 'skip') {
      // Small local penalty, no immediate thread destruction —
      // but repeated cold threads with low confidence retire.
      if (card?.source_thread_ids?.length) {
        for (const threadId of card.source_thread_ids) {
          await updateThreadTactical(supabase, threadId, {
            heat_delta: HEAT_DELTA_SKIP,
            fatigue_delta: 0,
            check_retirement: true,
          });
        }
      }
      await updateSessionAfterReaction(supabase, session_id, {
        strong_signal: false,
        novelty_debt_delta: 0,
      });

    } else if (event_type === 'back') {
      // Slow-burn indicator — recorded for reflection, no tactical change
      await updateSessionAfterReaction(supabase, session_id, {
        strong_signal: false,
        novelty_debt_delta: 0,
      });
    }

    // ─── Step 3: Reflection / composition triggers (deduped) ────────────
    const triggerResult = await checkTriggers(supabase, userId, session_id, event_type);

    // ─── Step 4: Next card via the SHARED orchestrator ──────────────────
    const { card: nextCard } = await selectAndDeliverCard(supabase, userId, session_id);

    return new Response(
      JSON.stringify({
        next_card: nextCard
          ? { id: nextCard.id, text: nextCard.text, format: nextCard.format, move: nextCard.move }
          : null,
        triggers_fired: triggerResult,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function computeSignalVector(
  eventType: EventType,
  dwellMs?: number,
  readRatio?: number,
): SignalVector {
  // docs/03 §Signal Vector. attention prefers the length-normalized read
  // ratio the client computes; falls back to a raw dwell heuristic.
  const attention = readRatio != null
    ? Math.min(readRatio, 1.0)
    : (dwellMs ? Math.min(dwellMs / 5000, 1.0) : 0.5);

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
    confirm_hypothesis?: boolean;
    check_retirement?: boolean;
  }
) {
  const { data: thread } = await supabase
    .from('threads')
    .select('heat, fatigue, confidence, status, positive_evidence')
    .eq('id', threadId)
    .single();

  if (!thread) return;

  const newHeat = Math.max(0, Math.min(1, thread.heat + updates.heat_delta));
  const newFatigue = Math.max(0, Math.min(1, thread.fatigue + updates.fatigue_delta));

  // Lifecycle transitions (docs/05 §Thread статуси) — mechanics-owned:
  let newStatus = thread.status;
  // candidate → active: first confirmed hit
  if (updates.confirm_hypothesis && thread.status === 'candidate') {
    newStatus = 'active';
  }
  // active → resting: fatigue crossed the threshold
  if (newFatigue > FATIGUE_THRESHOLD_RESTING && newStatus === 'active') {
    newStatus = 'resting';
  }
  // cold + unconfirmed → retired (docs/development 05: heat<0.2 AND conf<0.4)
  if (
    updates.check_retirement &&
    newHeat < HEAT_THRESHOLD_RETIRED &&
    thread.confidence < CONFIDENCE_THRESHOLD_RETIRED &&
    ['candidate', 'active'].includes(newStatus)
  ) {
    newStatus = 'retired';
  }

  const updateObj: Record<string, unknown> = {
    heat: newHeat,
    fatigue: newFatigue,
    status: newStatus,
    last_used_at: new Date().toISOString(),
  };
  if (updates.add_positive_evidence) {
    updateObj.positive_evidence = [
      ...(thread.positive_evidence || []),
      updates.add_positive_evidence,
    ];
  }

  await supabase.from('threads').update(updateObj).eq('id', threadId);
}


// Rhythm is updated at IMPRESSION time — what the user actually saw,
// in the order they saw it. docs/05 §rhythm_state.
async function updateRhythmOnImpression(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
  card: {
    move?: string;
    format?: string | null;
    recipe?: Record<string, unknown> | null;
    source_thread_ids?: string[] | null;
  } | null,
) {
  const { data: session } = await supabase
    .from('sessions')
    .select('rhythm_state, cards_shown, cards_since_reflection')
    .eq('id', sessionId)
    .single();
  if (!session) return;

  const rhythm = session.rhythm_state || {};
  const move = card?.move;
  const format = card?.format || (card?.recipe?.format as string | undefined);
  const voice = card?.recipe?.voice as string | undefined;

  // Novelty debt is REPAID by actually showing novel moves (docs/04)
  const repayment = move ? (NOVELTY_REPAYMENT[move] || 0) : 0;

  const updatedRhythm = {
    ...rhythm,
    recent_moves: [...(rhythm.recent_moves || []), move].filter(Boolean).slice(-10),
    recent_thread_ids: [
      ...(rhythm.recent_thread_ids || []),
      ...(card?.source_thread_ids || []),
    ].slice(-10),
    formats_recently_used: [...(rhythm.formats_recently_used || []), format]
      .filter(Boolean).slice(-5),
    voices_recently_used: [...(rhythm.voices_recently_used || []), voice]
      .filter(Boolean).slice(-5),
    novelty_debt: Math.max(0, (rhythm.novelty_debt || 0) - repayment),
  };

  await supabase
    .from('sessions')
    .update({
      rhythm_state: updatedRhythm,
      cards_shown: session.cards_shown + 1,
      cards_since_reflection: session.cards_since_reflection + 1,
    })
    .eq('id', sessionId);
}


async function updateSessionAfterReaction(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
  updates: { strong_signal: boolean; novelty_debt_delta: number },
) {
  const { data: session } = await supabase
    .from('sessions')
    .select('rhythm_state, strong_signals')
    .eq('id', sessionId)
    .single();
  if (!session) return;

  const rhythm = session.rhythm_state || {};
  await supabase
    .from('sessions')
    .update({
      rhythm_state: {
        ...rhythm,
        novelty_debt: Math.max(0, (rhythm.novelty_debt || 0) + updates.novelty_debt_delta),
      },
      strong_signals: session.strong_signals + (updates.strong_signal ? 1 : 0),
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
    .select('cards_since_reflection')
    .eq('id', sessionId)
    .single();
  if (!session) return triggered;

  // ── Reflection triggers (docs/06 §Trigger Conditions) ──
  // Dedup index guarantees at most ONE queued reflect per user at any time.
  const needsReflection =
    eventType === 'heart' ||
    eventType === 'share' ||
    session.cards_since_reflection >= REFLECTION_TRIGGER_CARDS_SINCE;

  if (needsReflection) {
    const result = await queueAiRun(supabase, {
      user_id: userId,
      session_id: sessionId,
      run_type: 'reflect',
      trigger_reason: eventType === 'heart'
        ? 'heart_signal'
        : eventType === 'share'
          ? 'share_signal'
          : `cards_since_reflection=${session.cards_since_reflection}`,
      prompt_version: PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
    });
    if (result === 'queued') {
      triggered.push('reflect');
      await supabase
        .from('sessions')
        .update({ cards_since_reflection: 0 })
        .eq('id', sessionId);
    }
  }

  // ── Composition trigger: frontier < MIN (deduped the same way) ──
  const { count: frontierCount } = await supabase
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'queued');

  if ((frontierCount || 0) < COMPOSE_TRIGGER_FRONTIER_MIN) {
    const result = await queueAiRun(supabase, {
      user_id: userId,
      session_id: sessionId,
      run_type: 'compose',
      trigger_reason: `frontier_size=${frontierCount}`,
      prompt_version: PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
    });
    if (result === 'queued') triggered.push('compose');
  }

  return triggered;
}
