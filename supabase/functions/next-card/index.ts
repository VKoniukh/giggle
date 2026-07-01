// ============================================================================
// Edge Function: next-card
// Version: 1.0.0
// Source: docs/06_EDGE_FUNCTIONS_AND_AI.md §3 — next-card
//
// Can be separate or called from record-signal. Does NOT call GPT.
// Target latency: <50ms
//
// Steps:
//   1. Find best queued card
//   2. Check thread versions (not stale?)
//   3. Check session hard constraints
//   4. Mark shown, set shown_at
//   5. Create impression event
//   6. If frontier < 3 → create compose ai_run
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createServiceClient,
  getUserIdFromAuth,
  corsHeaders,
} from '../_shared/supabase-client.ts';
import {
  MAX_SAME_THREAD_CONSECUTIVE,
  MAX_SAME_FORMAT_IN_5,
  COMPOSE_TRIGGER_FRONTIER_MIN,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from '../_shared/constants.ts';

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

    const body = await req.json().catch(() => ({}));
    const sessionId = body.session_id;

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'session_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Get session state for constraint checking ──────────────────────
    const { data: session } = await supabase
      .from('sessions')
      .select('rhythm_state')
      .eq('id', sessionId)
      .single();

    const rhythm = session?.rhythm_state || {};
    const recentThreadIds: string[] = rhythm.recent_thread_ids || [];
    const recentFormats: string[] = rhythm.formats_recently_used || [];

    // ─── Get queued candidates ──────────────────────────────────────────
    const { data: candidates } = await supabase
      .from('cards')
      .select('id, text, format, move, recipe, queue_priority, source_thread_ids, source_thread_versions')
      .eq('user_id', userId)
      .eq('status', 'queued')
      .order('queue_priority', { ascending: false })
      .limit(10);

    if (!candidates || candidates.length === 0) {
      // No cards available — trigger composition
      await supabase.from('ai_runs').insert({
        user_id: userId,
        session_id: sessionId,
        run_type: 'compose',
        status: 'queued',
        trigger_reason: 'frontier_empty',
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
      });

      return new Response(
        JSON.stringify({ next_card: null, reason: 'frontier_empty', compose_triggered: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Apply Hard Constraints (pre-score filter) ──────────────────────
    // docs/06 §Hard Constraints + docs/04 §Hard Constraints

    let selected = null;

    for (const candidate of candidates) {
      // Constraint 1: not more than MAX_SAME_THREAD_CONSECUTIVE from same thread
      if (candidate.source_thread_ids?.length) {
        const lastN = recentThreadIds.slice(-MAX_SAME_THREAD_CONSECUTIVE);
        const allSameThread = lastN.length >= MAX_SAME_THREAD_CONSECUTIVE &&
          lastN.every(tid => candidate.source_thread_ids!.includes(tid));
        if (allSameThread) continue;
      }

      // Constraint 2: not same format more than MAX_SAME_FORMAT_IN_5 in last 5
      const cardFormat = candidate.format || candidate.recipe?.format;
      if (cardFormat) {
        const formatCount = recentFormats.filter(f => f === cardFormat).length;
        if (formatCount >= MAX_SAME_FORMAT_IN_5) continue;
      }

      // Constraint 3: check staleness via thread versions
      if (candidate.source_thread_ids?.length && candidate.source_thread_versions) {
        let isStale = false;
        for (const [threadId, expectedVersion] of Object.entries(candidate.source_thread_versions)) {
          const { data: thread } = await supabase
            .from('threads')
            .select('version')
            .eq('id', threadId)
            .single();
          if (thread && thread.version > (expectedVersion as number)) {
            isStale = true;
            break;
          }
        }
        if (isStale) {
          // Mark as discarded
          await supabase
            .from('cards')
            .update({ status: 'discarded' })
            .eq('id', candidate.id);
          continue;
        }
      }

      // Passed all constraints
      selected = candidate;
      break;
    }

    if (!selected) {
      // All candidates failed constraints — use first one as fallback (MVP)
      selected = candidates[0];
    }

    // ─── Mark shown + create impression ─────────────────────────────────
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

    // ─── Check if frontier needs refill ─────────────────────────────────
    const { count: remainingFrontier } = await supabase
      .from('cards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'queued');

    let composeTriggered = false;
    if ((remainingFrontier || 0) < COMPOSE_TRIGGER_FRONTIER_MIN) {
      await supabase.from('ai_runs').insert({
        user_id: userId,
        session_id: sessionId,
        run_type: 'compose',
        status: 'queued',
        trigger_reason: `frontier_low=${remainingFrontier}`,
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
      });
      composeTriggered = true;
    }

    return new Response(
      JSON.stringify({
        next_card: {
          id: selected.id,
          text: selected.text,
          format: selected.format,
          move: selected.move,
        },
        frontier_remaining: remainingFrontier,
        compose_triggered: composeTriggered,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('next-card error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: error instanceof Error && error.message === 'Unauthorized' ? 401 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
