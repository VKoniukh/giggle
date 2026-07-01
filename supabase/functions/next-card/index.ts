// ============================================================================
// Edge Function: next-card
// Version: 2.0.0
// Source: docs/06_EDGE_FUNCTIONS_AND_AI.md §3 — next-card
//
// Thin wrapper over the SHARED orchestrator (_shared/orchestrator.ts).
// record-signal and next-card now select cards through the exact same
// hard-constraints + score formula. Does NOT call GPT.
//
// Cards are marked 'delivered' here (client buffer). They become 'shown'
// only when the client reports an impression via record-signal.
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createServiceClient,
  getUserIdFromAuth,
  corsHeaders,
} from '../_shared/supabase-client.ts';
import {
  COMPOSE_TRIGGER_FRONTIER_MIN,
  PROMPT_VERSION,
  SCHEMA_VERSION,
} from '../_shared/constants.ts';
import { selectAndDeliverCard, queueAiRun } from '../_shared/orchestrator.ts';

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

    const { card, frontierRemaining } = await selectAndDeliverCard(supabase, userId, sessionId);

    // Refill frontier when it runs low (deduped by the unique index)
    let composeTriggered = false;
    if (frontierRemaining < COMPOSE_TRIGGER_FRONTIER_MIN) {
      const result = await queueAiRun(supabase, {
        user_id: userId,
        session_id: sessionId,
        run_type: 'compose',
        trigger_reason: card ? `frontier_low=${frontierRemaining}` : 'frontier_empty',
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
      });
      composeTriggered = result === 'queued';
    }

    return new Response(
      JSON.stringify({
        next_card: card
          ? { id: card.id, text: card.text, format: card.format, move: card.move }
          : null,
        frontier_remaining: frontierRemaining,
        compose_triggered: composeTriggered,
        ...(card ? {} : { reason: 'frontier_empty' }),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
