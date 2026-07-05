// ============================================================================
// Edge Function: ai-worker
// Version: 1.0.0
// Source: docs/06_EDGE_FUNCTIONS_AND_AI.md §4 — ai-worker
//
// THE ONLY FUNCTION THAT CALLS OpenAI API.
// Takes ai_runs with status='queued' and processes them.
//
// 4 modes:
//   REFLECT            — analyze signals, patch threads
//   COMPOSE            — generate card candidates from missions
//   STRATEGIC_REFLECT  — long-term thread revision
//   DISTILL_QUALITY    — clean recipes for collective fund
//
// Execution model:
//   record-signal → EdgeRuntime.waitUntil() → ai-worker
//   OR: Supabase Cron picks up stale queued jobs
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createServiceClient,
  corsHeaders,
} from '../_shared/supabase-client.ts';
import {
  MODEL_COMPOSE,
  MODEL_REFLECT,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  COMPOSE_CANDIDATE_COUNT,
  REFLECTION_CARD_WINDOW,
  CANON_EXEMPLAR_COUNT,
  TEMPERATURE_COMPOSE,
  TEMPERATURE_REFLECT,
  TEMPERATURE_STRATEGIC,
  TEMPERATURE_DISTILL,
  estimateCost,
} from '../_shared/constants.ts';
import { buildComposeMissions, queueAiRun } from '../_shared/orchestrator.ts';
import {
  CONSTITUTION,
  REFLECTOR_CONTRACT,
  COMPOSER_CONTRACT,
  QUALITY_CONSTITUTION,
  STATIC_EXEMPLARS,
  REFLECTOR_SCHEMA,
  COMPOSER_SCHEMA,
  STRATEGIC_SCHEMA,
  DISTILL_SCHEMA,
  LANG_NAMES,
  LANG_ANCHORS,
  violatesLanguage,
  buildEvidenceDigest,
  buildThreadDigest,
  buildCanonDigest,
} from '../_shared/prompts.ts';
import type { AiRun, Thread, Card } from '../_shared/types.ts';

// Prompt layers A–D, strict schemas and evidence-digest builders live in
// _shared/prompts.ts — one source of truth for ai-worker AND start-session.

// Code-side defense in depth: even if a schema changes, mechanics-owned
// fields can never reach the DB from an AI patch.
const PATCH_WHITELIST = [
  'core', 'mechanism', 'emotional_payoffs', 'working_voices',
  'confirmed_contexts', 'contexts_to_try', 'avoid', 'open_question', 'depth',
] as const;

function sanitizePatch(patch: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  if (!patch) return clean;
  for (const key of PATCH_WHITELIST) {
    if (patch[key] != null) clean[key] = patch[key];
  }
  return clean;
}

// Queue a compose run carrying missions; if one is already queued (dedup
// index), merge the missions into it instead of losing them.
async function queueComposeMissions(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  sessionId: string | null,
  missions: Array<Record<string, unknown>>,
  reason: string,
) {
  const result = await queueAiRun(supabase, {
    user_id: userId,
    session_id: sessionId,
    run_type: 'compose',
    trigger_reason: reason,
    input_snapshot: { missions },
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
  });
  if (result === 'duplicate') {
    await supabase
      .from('ai_runs')
      .update({ input_snapshot: { missions }, trigger_reason: reason })
      .eq('user_id', userId)
      .eq('run_type', 'compose')
      .eq('status', 'queued');
  }
}


serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Parsed once, visible to the catch block (req body can't be re-read)
  let requestedRunId: string | null = null;

  try {
    const supabase = createServiceClient();

    // ─── Pick up queued job ──────────────────────────────────────────────
    // Can be called with specific run_id or pick oldest queued
    const body = await req.json().catch(() => ({}));
    requestedRunId = body.run_id || null;
    let run: AiRun | null = null;

    if (body.run_id) {
      const { data } = await supabase
        .from('ai_runs')
        .select('*')
        .eq('id', body.run_id)
        .eq('status', 'queued')
        .single();
      run = data;
    } else {
      // Pick oldest queued job
      const { data } = await supabase
        .from('ai_runs')
        .select('*')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      run = data;
    }

    if (!run) {
      return new Response(
        JSON.stringify({ message: 'No queued jobs' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Atomic claim: only ONE worker may take this run ────────────────
    const { data: claimed } = await supabase
      .from('ai_runs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        attempts: run.attempts + 1,
      })
      .eq('id', run.id)
      .eq('status', 'queued')
      .select('id');

    if (!claimed?.length) {
      return new Response(
        JSON.stringify({ message: 'Run already claimed by another worker' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Dispatch by run_type ───────────────────────────────────────────
    let result: WorkerResult;

    switch (run.run_type) {
      case 'reflect':
        result = await executeReflection(supabase, run);
        break;
      case 'compose':
      case 'cold_start_compose':
        result = await executeComposition(supabase, run);
        break;
      case 'strategic_reflect':
        result = await executeStrategicReflection(supabase, run);
        break;
      case 'distill_quality':
        result = await executeDistillQuality(supabase, run);
        break;
      default:
        throw new Error(`Unknown run_type: ${run.run_type}`);
    }

    // ─── Mark completed ─────────────────────────────────────────────────
    await supabase
      .from('ai_runs')
      .update({
        status: result.status,
        output: result.output,
        model: result.model,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cached_tokens: result.usage.cached_tokens,
        estimated_cost: result.usage.estimated_cost,
        completed_at: new Date().toISOString(),
      })
      .eq('id', run.id);

    return new Response(
      JSON.stringify({
        run_id: run.id,
        run_type: run.run_type,
        status: result.status,
        cards_created: result.cards_created || 0,
        threads_patched: result.threads_patched || 0,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('ai-worker error:', message);

    // Requeue for retry — the watchdog / dedup index guard against loops.
    // Marking 'queued' re-fires the pg_net trigger (migrations 003/004).
    try {
      if (requestedRunId) {
        const supabase = createServiceClient();
        const { data: failedRun } = await supabase
          .from('ai_runs')
          .select('attempts')
          .eq('id', requestedRunId)
          .single();
        await supabase
          .from('ai_runs')
          .update(
            (failedRun?.attempts ?? 3) >= 3
              ? { status: 'failed', completed_at: new Date().toISOString() }
              : { status: 'queued' }
          )
          .eq('id', requestedRunId);
      }
    } catch { /* best effort */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface WorkerResult {
  status: 'completed' | 'conflict' | 'failed';
  output: Record<string, unknown>;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    estimated_cost: number;
  };
  cards_created?: number;
  threads_patched?: number;
}


// ═══════════════════════════════════════════════════════════════════════════════
// OpenAI Call Helper
// ═══════════════════════════════════════════════════════════════════════════════

async function callOpenAI(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  responseSchema?: Record<string, unknown>,
  temperature: number = 0.8,
): Promise<{
  content: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number; cached_tokens: number };
}> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
  };

  // Use structured outputs if schema provided
  if (responseSchema) {
    requestBody.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'giggle_response',
        strict: true,
        schema: responseSchema,
      },
    };
  } else {
    requestBody.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = JSON.parse(data.choices[0].message.content);
  const usage = data.usage || {};

  return {
    content,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      cached_tokens: usage.prompt_tokens_details?.cached_tokens || 0,
    },
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Context Builders
// ═══════════════════════════════════════════════════════════════════════════════

async function buildUserContext(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  sessionId?: string | null,
) {
  // Active threads
  const { data: threads } = await supabase
    .from('threads')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['candidate', 'active', 'resting'])
    .order('heat', { ascending: false })
    .limit(10);

  // Recent shown cards with reactions
  const { data: recentCards } = await supabase
    .from('cards')
    .select('id, text, move, recipe, status, format')
    .eq('user_id', userId)
    .in('status', ['shown', 'hearted'])
    .order('shown_at', { ascending: false })
    .limit(REFLECTION_CARD_WINDOW);

  // Canon exemplars (best hits)
  const { data: canonCards } = await supabase
    .from('cards')
    .select('id, text, recipe, move')
    .eq('user_id', userId)
    .eq('status', 'hearted')
    .order('shown_at', { ascending: false })
    .limit(CANON_EXEMPLAR_COUNT);

  // Recent events for shown cards
  const recentCardIds = (recentCards || []).map((c: Card) => c.id);
  const { data: recentEvents } = await supabase
    .from('events')
    .select('card_id, event_type, signal_vector, dwell_ms')
    .in('card_id', recentCardIds.length > 0 ? recentCardIds : ['__none__']);

  // User mind
  const { data: userMind } = await supabase
    .from('user_minds')
    .select('*')
    .eq('user_id', userId)
    .single();

  // Session state
  let sessionState = null;
  if (sessionId) {
    const { data } = await supabase
      .from('sessions')
      .select('rhythm_state, cards_shown, strong_signals')
      .eq('id', sessionId)
      .single();
    sessionState = data;
  }

  return {
    threads: threads || [],
    recentCards: recentCards || [],
    canonCards: canonCards || [],
    recentEvents: recentEvents || [],
    userMind,
    sessionState,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Mode 1: REFLECT
// docs/06 §Reflector Contract
// "Reflector не пише жарти. Він дивиться на докази."
// ═══════════════════════════════════════════════════════════════════════════════

async function executeReflection(
  supabase: ReturnType<typeof createServiceClient>,
  run: AiRun,
): Promise<WorkerResult> {
  const model = MODEL_REFLECT;
  const ctx = await buildUserContext(supabase, run.user_id, run.session_id);

  // Layers A-C static (cached). Reflector doesn't need the composer craft
  // exemplars — dropping layer D here saves ~800 input tokens per reflect.
  const systemPrompt = [
    CONSTITUTION,
    REFLECTOR_CONTRACT,
    QUALITY_CONSTITUTION,
  ].join('\n\n---\n\n');

  // Layer E: code-digested evidence — the model interprets, the code counted.
  const rhythm = ctx.sessionState?.rhythm_state || {};
  const userPrompt = `THREADS (full ids + versions — required for thread_operations):
${buildThreadDigest(ctx.threads as Thread[], true)}

EVIDENCE WINDOW (newest first; cite card ids exactly as given):
${buildEvidenceDigest(ctx.recentCards as Card[], ctx.recentEvents as never[])}

CANON (texts that truly landed):
${buildCanonDigest(ctx.canonCards as Card[])}

Anti-patterns: ${JSON.stringify(ctx.userMind?.known_anti_patterns || [])}
Strategic summary: ${ctx.userMind?.strategic_summary || 'none yet'}
Familiar worlds: ${JSON.stringify(ctx.userMind?.onboarding_context?.familiar_worlds || [])}
Boundaries: ${JSON.stringify(ctx.userMind?.boundaries || {})}
Session rhythm: novelty_debt=${rhythm.novelty_debt ?? 0}, recent_moves=${JSON.stringify(rhythm.recent_moves || [])}, strong_signals=${ctx.sessionState?.strong_signals ?? 0}
Trigger: ${run.trigger_reason}

Run the protocol: strongest signal → competing explanations → discriminating tests → missions.
Missions must respect the user's boundaries and target language '${ctx.userMind?.language_state?.primary || 'uk'}'.`;

  const { content, usage } = await callOpenAI(
    model, systemPrompt, userPrompt, REFLECTOR_SCHEMA, TEMPERATURE_REFLECT,
  );
  const estimated = estimateCost(model, usage.input_tokens, usage.output_tokens, usage.cached_tokens);

  // ─── Apply thread patches with optimistic locking ─────────────────────
  // docs/06 §State Patch Application
  let threadsPatched = 0;
  let hasConflict = false;

  const threadOps = (content as { thread_operations?: Array<Record<string, unknown>> }).thread_operations || [];

  for (const op of threadOps) {
    if (op.operation === 'create' && op.patch) {
      // Create new thread
      const patch = sanitizePatch(op.patch as Record<string, unknown>);
      const { error } = await supabase.from('threads').insert({
        user_id: run.user_id,
        core: patch.core || 'New hypothesis',
        mechanism: patch.mechanism || 'To be determined',
        emotional_payoffs: patch.emotional_payoffs || [],
        working_voices: patch.working_voices || [],
        confirmed_contexts: patch.confirmed_contexts || [],
        contexts_to_try: patch.contexts_to_try || [],
        avoid: patch.avoid || [],
        open_question: patch.open_question || null,
        confidence: typeof op.confidence_delta === 'number' ? Math.max(0.1, op.confidence_delta) : 0.3,
        status: 'candidate',
      });
      if (!error) threadsPatched++;

    } else if (op.thread_id && op.expected_version != null) {
      // Patch existing thread with optimistic locking.
      // sanitizePatch = whitelist: AI can never touch heat/fatigue/status.
      const updateObj: Record<string, unknown> = sanitizePatch(
        op.patch as Record<string, unknown>,
      );

      // Apply confidence delta if provided
      if (typeof op.confidence_delta === 'number') {
        const { data: currentThread } = await supabase
          .from('threads')
          .select('confidence')
          .eq('id', op.thread_id)
          .single();
        if (currentThread) {
          updateObj.confidence = Math.max(0, Math.min(1,
            currentThread.confidence + (op.confidence_delta as number)));
        }
      }

      // Handle status changes
      if (op.operation === 'retire') updateObj.status = 'retired';
      if (op.operation === 'weaken' && typeof updateObj.confidence === 'number' && (updateObj.confidence as number) < 0.15) {
        updateObj.status = 'retired';
      }

      // Optimistic locking: WHERE version = expected_version
      updateObj.version = (op.expected_version as number) + 1;

      const { data: updated, error } = await supabase
        .from('threads')
        .update(updateObj)
        .eq('id', op.thread_id)
        .eq('version', op.expected_version)
        .select('id');

      if (error || !updated?.length) {
        hasConflict = true;
        console.warn(`Optimistic lock conflict on thread ${op.thread_id}, version ${op.expected_version}`);
      } else {
        threadsPatched++;
      }
    }
  }

  // ─── Apply session adjustments ──────────────────────────────────────
  const sessionAdj = (content as { session_adjustment?: Record<string, unknown> }).session_adjustment;
  if (sessionAdj && run.session_id) {
    const { data: session } = await supabase
      .from('sessions')
      .select('rhythm_state')
      .eq('id', run.session_id)
      .single();

    if (session) {
      const rhythm = session.rhythm_state || {};
      const updatedRhythm = {
        ...rhythm,
        current_temperature: sessionAdj.desired_temperature ?? rhythm.current_temperature,
        threads_to_rest: sessionAdj.threads_to_rest ?? rhythm.threads_to_rest,
      };
      await supabase
        .from('sessions')
        .update({ rhythm_state: updatedRhythm })
        .eq('id', run.session_id);
    }
  }

  // ─── Create compose missions from reflection output ─────────────────
  const missions = (content as { compose_missions?: Array<Record<string, unknown>> }).compose_missions || [];
  if (missions.length > 0) {
    await queueComposeMissions(
      supabase, run.user_id, run.session_id, missions, 'reflection_missions',
    );
  }

  // Update reflection bookkeeping
  await supabase
    .from('user_minds')
    .update({ last_reflection_at: new Date().toISOString() })
    .eq('user_id', run.user_id);

  return {
    status: hasConflict ? 'conflict' : 'completed',
    output: content as Record<string, unknown>,
    model,
    usage: { ...usage, estimated_cost: estimated },
    threads_patched: threadsPatched,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Mode 2: COMPOSE
// docs/06 §Composer Contract
// "Composer не змінює нитки. Він матеріалізує задані місії."
// ═══════════════════════════════════════════════════════════════════════════════

async function executeComposition(
  supabase: ReturnType<typeof createServiceClient>,
  run: AiRun,
): Promise<WorkerResult> {
  const model = MODEL_COMPOSE;
  const ctx = await buildUserContext(supabase, run.user_id, run.session_id);

  // docs/04 §Поділ влади: the MECHANICS decide which moves the session
  // needs. If the run carries no missions from a Reflector, the
  // deterministic mission builder creates them from thread/rhythm state.
  // The AI NEVER decides "what kind of move to make" on its own.
  let missions = (run.input_snapshot as { missions?: Array<Record<string, unknown>> })?.missions || [];
  if (missions.length === 0) {
    missions = buildComposeMissions(
      ctx.threads as Thread[],
      (ctx.sessionState?.rhythm_state as never) || null,
      ctx.userMind,
      COMPOSE_CANDIDATE_COUNT,
    ) as unknown as Array<Record<string, unknown>>;
  }

  // Pre-onboarding generation runs BEFORE the user sets boundaries (step 3).
  // Boundaries are unknown → only universally safe territories are allowed.
  const isPreOnboarding =
    (run.input_snapshot as { stage?: string })?.stage === 'pre_onboarding';
  const safetyBlock = isPreOnboarding
    ? `\n⚠️ SAFETY: The user has NOT yet set content boundaries. Generate ONLY universally safe probes.
FORBIDDEN in this batch: death/disease, sex, politics, religion, violence, profanity, cruelty, humiliation.
Allowed nerves: everyday absurdity, tender human imperfection, social awkwardness (mild), language itself, adulthood performance, technology confusion.\n`
    : '';

  // Build system prompt: layers A-D (static, cached)
  const systemPrompt = [
    CONSTITUTION,
    COMPOSER_CONTRACT,
    QUALITY_CONSTITUTION,
    STATIC_EXEMPLARS,
  ].join('\n\n---\n\n');

  // Determine language
  const language = ctx.userMind?.language_state?.primary || 'uk';
  const culturalContext = ctx.userMind?.language_state?.cultural_context || 'UA';
  const familiarWorlds = ctx.userMind?.onboarding_context?.familiar_worlds || [];
  const langName = LANG_NAMES[language] || language;

  // Layer E: Dynamic User Packet — numbered missions bind candidates to
  // experiments via mission_index (lineage + one-candidate-per-mission).
  const numberedMissions = missions
    .map((m, i) => `${i}. [${m.move}] ${m.purpose}${m.target_context ? ` | target: ${m.target_context}` : ''}${m.tests_question ? ` | tests: ${m.tests_question}` : ''}${m.thread_ids && (m.thread_ids as string[]).length ? ` | threads: ${(m.thread_ids as string[]).join(',')}` : ''}`)
    .join('\n');

  const userPrompt = `🔴 TARGET LANGUAGE: ${langName} (code: ${language}).
${LANG_ANCHORS[language] || `Write "unspoken_truth", "angle" and "text" strictly in ${langName}.`}
User lives in: ${culturalContext} — cultural references only, NOT the text language.

Familiar worlds: ${JSON.stringify(familiarWorlds)}
Boundaries: ${JSON.stringify(ctx.userMind?.boundaries || {})}
Anti-patterns (never do these): ${JSON.stringify(ctx.userMind?.known_anti_patterns || [])}
${safetyBlock}
MISSIONS — exactly ONE candidate per mission, set its mission_index accordingly.
The mission defines WHAT to test; you define only HOW to land it:
${numberedMissions}

ACTIVE THREADS (context for missions that reference them):
${buildThreadDigest(ctx.threads as Thread[], false)}

CANON — texts that truly made THIS person laugh. Study the mechanisms.
Never copy surfaces; share no more than 2 content words with any of them:
${buildCanonDigest(ctx.canonCards as Card[])}

RECENT SEQUENCE (do not repeat these moves/voices/formats back-to-back):
${JSON.stringify(ctx.recentCards.slice(0, 5).map((c: Card) => ({
    move: c.move,
    format: c.format,
    voice: c.recipe?.voice,
  })))}

⚠️ FINAL CHECK: Every "text" value MUST be in ${langName}. NOT English. NOT Polish. NOT Russian. ONLY ${langName}.`;

  const { content, usage } = await callOpenAI(
    model, systemPrompt, userPrompt, COMPOSER_SCHEMA, TEMPERATURE_COMPOSE,
  );
  const estimated = estimateCost(model, usage.input_tokens, usage.output_tokens, usage.cached_tokens);

  // ─── Insert generated cards into frontier ─────────────────────────────
  const candidates = ((content as { candidates?: Array<Record<string, unknown>> }).candidates || [])
    .slice(0, COMPOSE_CANDIDATE_COUNT + 2);
  let cardsCreated = 0;
  let languageViolations = 0;
  let compressionViolations = 0;

  // Only thread ids we actually gave the model are valid lineage —
  // hallucinated ids would corrupt staleness checks / break uuid[] casts.
  const knownThreadIds = new Set((ctx.threads as Thread[]).map((t) => t.id));

  for (const [index, candidate] of candidates.entries()) {
    // COMPRESSION LAW, enforced deterministically: the prompt demands ≤40
    // words; anything past 55 is an uncompressed draft — never show it.
    const text = ((candidate.text as string) || '').trim();
    const wordCount = text ? text.split(/\s+/).length : 0;
    if (!text || wordCount > 55) {
      compressionViolations++;
      console.warn(`compose: discarded uncompressed candidate (${wordCount} words)`);
      continue;
    }

    // LANGUAGE LAW: the user must NEVER see a drifted card. The model may
    // fail; the product may not.
    if (violatesLanguage(text, language)) {
      languageViolations++;
      console.warn(`compose: discarded language-drifted candidate (target=${language}): "${text.slice(0, 60)}"`);
      continue;
    }

    const sourceThreadIds = ((candidate.source_thread_ids as string[]) || [])
      .filter((tid) => knownThreadIds.has(tid));
    // Build source_thread_versions for staleness checking
    const threadVersions: Record<string, number> = {};
    for (const tid of sourceThreadIds) {
      const thread = ctx.threads.find((t: Thread) => t.id === tid);
      if (thread) threadVersions[tid] = thread.version;
    }

    const { error } = await supabase.from('cards').insert({
      user_id: run.user_id,
      session_id: run.session_id,
      text,
      language,
      format: (candidate.recipe as Record<string, unknown>)?.format || null,
      move: (candidate.move as string) || 'probe',
      recipe: candidate.recipe || {},
      hypothesis_tested: candidate.hypothesis_tested || null,
      expected_learning: candidate.expected_learning || null,
      source_thread_ids: sourceThreadIds.length > 0 ? sourceThreadIds : null,
      source_thread_versions: Object.keys(threadVersions).length > 0 ? threadVersions : null,
      generated_by_run_id: run.id,
      status: 'queued',
      queue_priority: 0.8 - (index * 0.05), // first candidate = highest priority
      scope: 'personal',
    });

    if (!error) cardsCreated++;
  }

  return {
    status: 'completed',
    // Validation counters ride inside output → queryable per model /
    // prompt_version straight from ai_runs (objective quality telemetry).
    output: {
      ...(content as Record<string, unknown>),
      validation: {
        language_violations: languageViolations,
        compression_violations: compressionViolations,
        accepted: cardsCreated,
      },
    },
    model,
    usage: { ...usage, estimated_cost: estimated },
    cards_created: cardsCreated,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Mode 3: STRATEGIC_REFLECT
// docs/06 §Strategic Reflection Rights
// "AI переглядає не картки, а історію розвитку ниток"
// ═══════════════════════════════════════════════════════════════════════════════

async function executeStrategicReflection(
  supabase: ReturnType<typeof createServiceClient>,
  run: AiRun,
): Promise<WorkerResult> {
  const model = MODEL_REFLECT;
  const ctx = await buildUserContext(supabase, run.user_id, run.session_id);

  // Get ALL threads for strategic view (not just active)
  const { data: allThreads } = await supabase
    .from('threads')
    .select('*')
    .eq('user_id', run.user_id)
    .order('created_at', { ascending: true });

  // Get session history
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, started_at, ended_at, cards_shown, strong_signals')
    .eq('user_id', run.user_id)
    .order('started_at', { ascending: false })
    .limit(10);

  const systemPrompt = [
    CONSTITUTION,
    REFLECTOR_CONTRACT,
    QUALITY_CONSTITUTION,
    `STRATEGIC MODE RIGHTS:
- merge threads that share a deeper mechanism
- split vague threads into specific hypotheses
- retire false hypotheses
- wake dormant threads for callback
- compress strategic summary
- identify shared mechanisms across domains
- nominate quality recipes from strong hits`,
  ].join('\n\n---\n\n');

  const userPrompt = `STRATEGIC REFLECTION:

All threads (full history):
${JSON.stringify((allThreads || []).map((t: Thread) => ({
    id: t.id,
    core: t.core,
    mechanism: t.mechanism,
    confidence: t.confidence,
    heat: t.heat,
    depth: t.depth,
    status: t.status,
    version: t.version,
    open_question: t.open_question,
    positive_evidence: t.positive_evidence?.length || 0,
    counter_evidence: t.counter_evidence?.length || 0,
    created_at: t.created_at,
  })))}

Session history:
${JSON.stringify(sessions || [])}

Current strategic summary: ${ctx.userMind?.strategic_summary || 'None yet'}
Known anti-patterns: ${JSON.stringify(ctx.userMind?.known_anti_patterns || [])}
Unexplored frontiers: ${JSON.stringify(ctx.userMind?.unexplored_frontiers || [])}

User language: ${ctx.userMind?.language_state?.primary || 'uk'}
Cultural context: ${ctx.userMind?.language_state?.cultural_context || 'UA'}
Familiar worlds: ${JSON.stringify(ctx.userMind?.onboarding_context?.familiar_worlds || [])}
Boundaries: ${JSON.stringify(ctx.userMind?.boundaries || {})}

Canon size: ${ctx.canonCards.length}

Provide strategic analysis. Focus on: which threads are real vs accidental, what deeper mechanisms connect them, what's been overexploited, what's untouched.
Strategy COMPRESSES: strategic_summary ≤ 80 words, written as claims the Composer can act on, not prose. Keep anti-patterns and frontiers to ≤ 8 items each — drop stale ones.
All compose_missions must respect boundaries and target language '${ctx.userMind?.language_state?.primary || 'uk'}'.`;

  const { content, usage } = await callOpenAI(
    model, systemPrompt, userPrompt, STRATEGIC_SCHEMA, TEMPERATURE_STRATEGIC,
  );
  const estimated = estimateCost(model, usage.input_tokens, usage.output_tokens, usage.cached_tokens);

  // Apply thread operations (same logic as reflect)
  let threadsPatched = 0;
  const threadOps = (content as { thread_operations?: Array<Record<string, unknown>> }).thread_operations || [];

  for (const op of threadOps) {
    if (op.thread_id && op.expected_version != null) {
      const updateObj: Record<string, unknown> = sanitizePatch(
        op.patch as Record<string, unknown>,
      );
      // Strategic rights (docs/06): retire / merge / wake are STATUS moves
      // the strategic reflector IS allowed to make — applied by code.
      if (op.operation === 'retire') updateObj.status = 'retired';
      if (op.operation === 'merge') updateObj.status = 'retired'; // merged threads retire
      updateObj.version = (op.expected_version as number) + 1;

      const { data: updated } = await supabase
        .from('threads')
        .update(updateObj)
        .eq('id', op.thread_id)
        .eq('version', op.expected_version)
        .select('id');

      if (updated?.length) threadsPatched++;
    }
  }

  // Update user_minds strategic state
  const strategicContent = content as Record<string, unknown>;
  const strategicUpdate: Record<string, unknown> = {
    last_strategic_reflection_at: new Date().toISOString(),
  };
  if (strategicContent.strategic_summary) {
    strategicUpdate.strategic_summary = strategicContent.strategic_summary;
  }
  if (strategicContent.known_anti_patterns) {
    strategicUpdate.known_anti_patterns = strategicContent.known_anti_patterns;
  }
  if (strategicContent.unexplored_frontiers) {
    strategicUpdate.unexplored_frontiers = strategicContent.unexplored_frontiers;
  }

  await supabase
    .from('user_minds')
    .update(strategicUpdate)
    .eq('user_id', run.user_id);

  // Queue compose missions (deduped / merged)
  const missions = (content as { compose_missions?: Array<Record<string, unknown>> }).compose_missions || [];
  if (missions.length > 0) {
    await queueComposeMissions(
      supabase, run.user_id, run.session_id, missions, 'strategic_reflection_missions',
    );
  }

  // ── Queue distill_quality if canon candidates accumulated ──
  // docs/06: distill_quality extracts reusable recipes for Quality Fund
  // Triggered from strategic_reflect (event-driven, no cron)
  const { count: canonCandidateCount } = await supabase
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', run.user_id)
    .eq('quality_state', 'canon_candidate');

  if ((canonCandidateCount || 0) >= 3) {
    await queueAiRun(supabase, {
      user_id: run.user_id,
      run_type: 'distill_quality',
      trigger_reason: `strategic_reflect_canon_candidates=${canonCandidateCount}`,
      prompt_version: PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
    });
  }

  return {
    status: 'completed',
    output: content as Record<string, unknown>,
    model,
    usage: { ...usage, estimated_cost: estimated },
    threads_patched: threadsPatched,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Mode 4: DISTILL_QUALITY
// docs/06 §distill_quality
// Clean recipes for the collective Quality Fund
// ═══════════════════════════════════════════════════════════════════════════════

async function executeDistillQuality(
  supabase: ReturnType<typeof createServiceClient>,
  run: AiRun,
): Promise<WorkerResult> {
  const model = MODEL_COMPOSE;

  // Get hearted cards that are canon_candidates
  const { data: candidates } = await supabase
    .from('cards')
    .select('id, text, recipe, move, language')
    .eq('user_id', run.user_id)
    .eq('quality_state', 'canon_candidate')
    .limit(10);

  if (!candidates?.length) {
    return {
      status: 'completed',
      output: { message: 'No canon candidates to distill' },
      model,
      usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0, estimated_cost: 0 },
    };
  }

  const systemPrompt = [
    CONSTITUTION,
    `MODE: QUALITY DISTILLER

You analyze strong-hit cards and extract reusable semantic recipes.
For each card, determine:
1. Is the TEXT itself reusable (no personal context embedded)?
   → scope = reusable_exact
2. Is only the MECHANISM reusable (text contains personal specifics)?
   → scope = reusable_recipe, extract clean recipe
3. Is it too personal to share?
   → scope = personal

Also assess diagnostic_purpose: would this card differentiate between two user types during cold start?`,
  ].join('\n\n---\n\n');

  const userPrompt = `DISTILL these strong-hit cards into quality recipes:

${JSON.stringify(candidates.map((c: Card) => ({
    id: c.id,
    text: c.text,
    recipe: c.recipe,
    move: c.move,
  })), null, 2)}

For each card, return: card_id, scope (reusable_exact | reusable_recipe | personal), cleaned_recipe, diagnostic_purpose (or null).`;

  const { content, usage } = await callOpenAI(
    model, systemPrompt, userPrompt, DISTILL_SCHEMA, TEMPERATURE_DISTILL,
  );
  const estimated = estimateCost(model, usage.input_tokens, usage.output_tokens, usage.cached_tokens);

  // Insert quality recipes
  const distilled = (content as { recipes?: Array<Record<string, unknown>> }).recipes || [];
  let recipesCreated = 0;

  for (const item of distilled) {
    if (item.scope === 'personal') {
      // Mark the card but don't add to collective fund
      await supabase
        .from('cards')
        .update({ quality_state: 'personal', scope: 'personal' })
        .eq('id', item.card_id);
      continue;
    }

    const sourceCard = candidates.find((c: Card) => c.id === item.card_id);
    const { error } = await supabase.from('quality_recipes').insert({
      recipe: item.cleaned_recipe || sourceCard?.recipe || {},
      diagnostic_purpose: item.diagnostic_purpose || null,
      text: item.scope === 'reusable_exact' ? sourceCard?.text : null,
      language: sourceCard?.language || 'uk',
      source_card_id: item.card_id as string,
      source_run_id: run.id,
      privacy_state: 'clean',
    });

    if (!error) {
      recipesCreated++;
      // Update card scope
      await supabase
        .from('cards')
        .update({
          quality_state: 'distilled',
          scope: item.scope as string,
        })
        .eq('id', item.card_id);
    }
  }

  return {
    status: 'completed',
    output: content as Record<string, unknown>,
    model,
    usage: { ...usage, estimated_cost: estimated },
    cards_created: recipesCreated,
  };
}
