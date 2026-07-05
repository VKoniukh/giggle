// ============================================================================
// Edge Function: start-session
// Version: 2.0.0
// Source: docs/06_EDGE_FUNCTIONS_AND_AI.md §1 — start-session
//         docs/03_PRODUCT_SYSTEM.md §Onboarding — diagnostic probes
//         docs/02_LAUGH_TOPOLOGY.md — orthogonal dimensions
//
// Flow:
//   1. Create session record
//   2. Try quality_recipes for ready probes (collective fund)
//   3. If not enough probes → GENERATE diagnostic set based on user context
//   4. Insert probes into frontier
//   5. Queue background compose for more personalized cards
//   6. Return first cards
//
// Key insight: quality_recipes grows ORGANICALLY via distill_quality.
//   For the first users, we generate diagnostic probes inline based on
//   their onboarding context (language, culture, familiar worlds, permissions).
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  createServiceClient,
  getUserIdFromAuth,
  corsHeaders,
} from '../_shared/supabase-client.ts';
import {
  FUNCTION_VERSION,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  MODEL_COMPOSE,
  STRATEGIC_TRIGGER_SESSIONS,
  STRATEGIC_TRIGGER_CANON,
  estimateCost,
} from '../_shared/constants.ts';
import { queueAiRun, violatesBoundaries } from '../_shared/orchestrator.ts';
import {
  CONSTITUTION,
  DIAGNOSTIC_CONTRACT,
  QUALITY_CONSTITUTION,
  STATIC_EXEMPLARS,
  LANG_NAMES,
  LANG_ANCHORS,
  violatesLanguage,
} from '../_shared/prompts.ts';
import type { RhythmState, Card, QualityRecipe } from '../_shared/types.ts';


// ─── Diagnostic Probe Generator Prompt ──────────────────────────────────────
// docs/03: "Ортогональні проби: одна тема — різні механізми,
//            один механізм — різні теми"
// docs/02: 7 deep layers, 10 mirth types, 12+ comic operators

// Diagnostic system prompt is composed from the shared prompt layers
// (_shared/prompts.ts) — same constitution and craft as the Composer,
// plus the first-contact diagnostic contract.
const DIAGNOSTIC_SYSTEM_PROMPT = [
  CONSTITUTION,
  DIAGNOSTIC_CONTRACT,
  QUALITY_CONSTITUTION,
  STATIC_EXEMPLARS,
].join('\n\n---\n\n');



serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ─── Auth ────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = await getUserIdFromAuth(authHeader);
    const supabase = createServiceClient();

    // ─── Step 0: Check user_minds exists, create if not ────────────────
    const { data: userMind } = await supabase
      .from('user_minds')
      .select('user_id, onboarding_completed, language_state, boundaries, onboarding_context, last_strategic_reflection_at')
      .eq('user_id', userId)
      .single();

    if (!userMind) {
      const { error: insertError } = await supabase
        .from('user_minds')
        .insert({ user_id: userId });

      if (insertError) {
        throw new Error(`Failed to create user_mind: ${insertError.message}`);
      }
    }

    // ─── Step 1: End any active sessions, create new one ───────────────
    // Lazy Evaluation: instead of pg_cron, close orphan sessions here and trigger AI reflection
    const { data: staleSessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (staleSessions && staleSessions.length > 0) {
      await supabase
        .from('sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .in('id', staleSessions.map(s => s.id));

      // Session end → ONE tactical reflection (docs/06: "session end" is a
      // reflection trigger). Deduped by the unique index.
      await queueAiRun(supabase, {
        user_id: userId,
        session_id: staleSessions[0].id,
        run_type: 'reflect',
        trigger_reason: 'session_end_lazy_evaluation',
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
      });
    }

    // Strategic reflection is RARE and counter-based (docs/06 §Strategic
    // Reflection Trigger: 3 completed sessions / 5 new canon cards) —
    // NOT on every app open. It is the most expensive operation we have.
    const lastStrategicAt = userMind?.last_strategic_reflection_at || '1970-01-01';
    const [{ count: endedSinceStrategic }, { count: canonSinceStrategic }] = await Promise.all([
      supabase
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'ended')
        .gte('ended_at', lastStrategicAt),
      supabase
        .from('cards')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'hearted')
        .gte('created_at', lastStrategicAt),
    ]);

    if (
      (endedSinceStrategic || 0) >= STRATEGIC_TRIGGER_SESSIONS ||
      (canonSinceStrategic || 0) >= STRATEGIC_TRIGGER_CANON
    ) {
      await queueAiRun(supabase, {
        user_id: userId,
        run_type: 'strategic_reflect',
        trigger_reason: `sessions=${endedSinceStrategic},canon=${canonSinceStrategic}`,
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
      });
    }

    const initialRhythm: RhythmState = {
      recent_moves: [],
      recent_thread_ids: [],
      current_temperature: 0.5,
      novelty_debt: 0.0,
      risk_budget: 0.5,
      intensity: 0.5,
      formats_recently_used: [],
      threads_to_rest: [],
    };

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        user_id: userId,
        status: 'active',
        rhythm_state: initialRhythm,
      })
      .select('id')
      .single();

    if (sessionError || !session) {
      throw new Error(`Failed to create session: ${sessionError?.message}`);
    }

    // ─── Step 1.4: Recycle undelivered cards from previous sessions ─────
    // Cards sent to a client buffer but never seen ('delivered', no
    // impression) are still valid experiments — return them to the queue
    // instead of paying to regenerate them.
    await supabase
      .from('cards')
      .update({ status: 'queued' })
      .eq('user_id', userId)
      .eq('status', 'delivered');

    // ─── Step 1.5: Check for pre-generated cards ────────────────────────
    // language.tsx triggers cold_start_compose during onboarding step 1.
    // By the time user reaches feed (~20-30 sec later), cards may already
    // be generated and waiting. Use them → instant first card.
    // IMPORTANT: only use cards matching current language!
    const userLanguage = userMind?.language_state?.primary || 'uk';
    const forbiddenZones: string[] = userMind?.boundaries?.forbidden || [];

    const { data: preGeneratedRaw } = await supabase
      .from('cards')
      .select('id, text, format, move, recipe, status, queue_priority')
      .eq('user_id', userId)
      .eq('status', 'queued')
      .eq('language', userLanguage)
      .order('queue_priority', { ascending: false })
      .limit(12);

    // SAFETY: pre-generation ran at onboarding step 1, BEFORE the user set
    // boundaries at step 3. Never show a card that violates the final
    // boundaries — discard it here.
    const boundaryViolators = (preGeneratedRaw || []).filter(
      (c) => violatesBoundaries(c, forbiddenZones),
    );
    if (boundaryViolators.length) {
      await supabase
        .from('cards')
        .update({ status: 'discarded' })
        .in('id', boundaryViolators.map((c) => c.id));
    }
    const preGenerated = (preGeneratedRaw || []).filter(
      (c) => !violatesBoundaries(c, forbiddenZones),
    );

    if (preGenerated && preGenerated.length >= 3) {
      // Deliver only the FIRST 4 to the client buffer. The rest stay queued
      // server-side and flow through the orchestrator — so after the first
      // heart the user sees ADAPTED cards within the same session, not a
      // pre-printed batch (source: "не газета, а rolling frontier").
      const toDeliver = preGenerated.slice(0, 4);
      await supabase
        .from('cards')
        .update({ session_id: session.id })
        .in('id', preGenerated.map((c) => c.id));
      await supabase
        .from('cards')
        .update({ status: 'delivered' })
        .in('id', toDeliver.map((c) => c.id));

      // Still queue a background compose for more cards (deduped)
      await queueAiRun(supabase, {
        user_id: userId,
        session_id: session.id,
        run_type: 'compose',
        trigger_reason: 'post_pregenerated_compose',
        input_snapshot: {
          onboarding_context: userMind?.onboarding_context || {},
          boundaries: userMind?.boundaries || {},
          language_state: userMind?.language_state || {},
        },
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
      });

      return new Response(
        JSON.stringify({
          session_id: session.id,
          cards: toDeliver,
          frontier_size: preGenerated.length,
          generated_fresh: false,
          pre_generated: true,
          version: FUNCTION_VERSION,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // ─── Step 2: Try quality_recipes (collective fund) ──────────────────
    // docs/06: "Перші ready probes підбираються за мовою, дозволеними межами,
    //           знайомими світами, максимальною діагностичною різницею"

    const forbidden = userMind?.boundaries?.forbidden || [];

    const { data: recipes } = await supabase
      .from('quality_recipes')
      .select('*')
      .eq('language', userLanguage)
      .order('prior_strength', { ascending: false })
      .limit(20);

    // Filter forbidden content
    const filteredRecipes = (recipes || []).filter((r: QualityRecipe) => {
      if (forbidden.length > 0 && r.recipe) {
        const recipeStr = JSON.stringify(r.recipe).toLowerCase();
        return !forbidden.some((f: string) => recipeStr.includes(f.toLowerCase()));
      }
      return true;
    });

    // ─── Step 3: Decide — use existing recipes OR generate fresh ────────
    // docs/03: "Перші 8-12 карток — діагностичні probes. Ортогональні проби"
    const MIN_DIAGNOSTIC_PROBES = 6;
    let diagnosticCards: Partial<Card>[] = [];

    if (filteredRecipes.length >= MIN_DIAGNOSTIC_PROBES) {
      // ── Path A: Collective fund has enough probes → use them (fast) ──
      const selectedRecipes = filteredRecipes.slice(0, 8);
      diagnosticCards = selectedRecipes.map(
        (recipe: QualityRecipe, index: number) => ({
          user_id: userId,
          session_id: session.id,
          text: recipe.text || '',
          language: recipe.language,
          format: recipe.recipe?.format || null,
          move: 'probe' as const,
          recipe: recipe.recipe || {},
          hypothesis_tested: recipe.diagnostic_purpose,
          expected_learning: {
            if_heart: 'This probe dimension resonated — open thread',
            if_stop_without_heart: 'Mechanism may need adjustment',
            if_fast_skip: 'Weak signal, do not overinterpret',
          },
          source_thread_ids: null,
          source_thread_versions: null,
          parent_card_ids: null,
          status: 'queued' as const,
          queue_priority: 1.0 - (index * 0.05),
          scope: 'global_probe' as const,
        })
      );

    } else {
      // ── Path B: Generate diagnostic probes based on user context ──
      // This is the creative engine: AI generates ORTHOGONAL probes
      // tailored to this user's world, language, and permissions
      const onboardingContext = userMind?.onboarding_context || {};
      const boundaries = userMind?.boundaries || {};
      const languageState = userMind?.language_state || { primary: 'uk', cultural_context: 'UA' };

      const langCode = languageState.primary || 'uk';
      const langName = LANG_NAMES[langCode] || langCode;

      const userPrompt = `🔴 TARGET LANGUAGE: ${langName} (code: ${langCode}).
${LANG_ANCHORS[langCode] || `Write "unspoken_truth" and "text" strictly in ${langName}.`}
User lives in: ${languageState.cultural_context || 'UA'} — cultural references only, NOT the text language.

Generate 8 diagnostic resonance probes for a new user.

USER CONTEXT:
- Familiar worlds: ${JSON.stringify(onboardingContext.familiar_worlds || ['not specified'])}
- Life context hints: ${JSON.stringify(onboardingContext.life_context_hints || [])}
- Allowed topics: ${JSON.stringify(boundaries.allowed || ['all'])}
- Restricted topics (use carefully): ${JSON.stringify(boundaries.restricted || [])}
- Forbidden topics (NEVER touch): ${JSON.stringify(boundaries.forbidden || [])}

Apply the diagnostic coverage mix and the full craft procedure (truth → angle →
compress ≤ 40 words → kill-check) to each probe. Use familiar worlds as CONTEXT,
not as a genre filter.

Return JSON:
{
  "probes": [
    {
      "unspoken_truth": "the specific human truth this probe compresses — in ${langName}",
      "text": "THE ACTUAL TEXT IN ${langName}",
      "format": "inner_monologue | dialogue | fake_notification | confession | search_query | ...",
      "recipe": {
        "charged_tension": "what reality this touches",
        "transformation": "what comic operator is used",
        "voice": "who is speaking",
        "emotional_fuel": ["recognition", "relief", ...],
        "distance": "self-inclusive | observational | intimate | cosmic",
        "novelty_axis": "what makes this different from the other probes"
      },
      "diagnostic_purpose": "what this probe tests / differentiates",
      "expected_learning": {
        "if_heart": "what we learn if user hearts this",
        "if_stop_without_heart": "what we learn if user reads but doesn't heart",
        "if_fast_skip": "what we learn if user skips quickly"
      }
    }
  ]
}

⚠️ FINAL CHECK: every "text" strictly in ${langName}, ≤ 40 words, kill-checked.`;

      try {
        // Synchronous AI call — user waits, but this is their FIRST session
        // and they just completed onboarding, so brief wait is acceptable
        const apiKey = Deno.env.get('OPENAI_API_KEY');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

        const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: MODEL_COMPOSE,
            messages: [
              { role: 'system', content: DIAGNOSTIC_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.9, // Higher creativity for probes
            response_format: { type: 'json_object' },
          }),
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          throw new Error(`OpenAI error ${aiResponse.status}: ${errorText}`);
        }

        const aiData = await aiResponse.json();
        const generated = JSON.parse(aiData.choices[0].message.content);
        const probes = generated.probes || [];
        const usage = aiData.usage || {};

        // Record this generation as an ai_run for lineage
        const usedModel = MODEL_COMPOSE;
        const inputToks = usage.prompt_tokens || 0;
        const outputToks = usage.completion_tokens || 0;
        const cachedToks = usage.prompt_tokens_details?.cached_tokens || 0;
        const cost = estimateCost(usedModel, inputToks, outputToks, cachedToks);

        const { data: aiRun } = await supabase
          .from('ai_runs')
          .insert({
            user_id: userId,
            session_id: session.id,
            run_type: 'cold_start_compose',
            status: 'completed',
            trigger_reason: 'first_session_diagnostic_generation',
            input_snapshot: {
              onboarding_context: onboardingContext,
              boundaries,
              language_state: languageState,
            },
            output: generated,
            model: usedModel,
            prompt_version: PROMPT_VERSION,
            schema_version: SCHEMA_VERSION,
            input_tokens: inputToks,
            output_tokens: outputToks,
            cached_tokens: cachedToks,
            estimated_cost: cost,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        // Transform AI output into card records.
        // LANGUAGE LAW: drifted probes never reach the user's first session —
        // first contact is exactly where trust is won or lost.
        const validProbes = probes.filter((probe: Record<string, unknown>) => {
          const t = ((probe.text as string) || '').trim();
          if (!t || violatesLanguage(t, userLanguage)) {
            console.warn(`start-session: discarded drifted probe (target=${userLanguage}): "${t.slice(0, 60)}"`);
            return false;
          }
          return true;
        });

        diagnosticCards = validProbes.map(
          (probe: Record<string, unknown>, index: number) => ({
            user_id: userId,
            session_id: session.id,
            text: probe.text as string,
            language: userLanguage,
            format: (probe.format as string) || null,
            move: 'probe' as const,
            recipe: probe.recipe || {},
            hypothesis_tested: probe.diagnostic_purpose || null,
            expected_learning: probe.expected_learning || null,
            source_thread_ids: null,
            source_thread_versions: null,
            parent_card_ids: null,
            generated_by_run_id: aiRun?.id || null,
            status: 'queued' as const,
            queue_priority: 1.0 - (index * 0.05),
            scope: 'personal' as const,
          })
        );

      } catch (aiError: any) {
        console.error('Diagnostic generation failed:', aiError);
        throw new Error(`Diagnostic generation failed: ${aiError.message}`);
      }
    }

    // ─── Step 4: Insert cards into frontier ──────────────────────────────
    let insertedCards: Card[] = [];
    if (diagnosticCards.length > 0) {
      const { data: cards, error: cardsError } = await supabase
        .from('cards')
        .insert(diagnosticCards)
        .select('id, text, format, move, recipe, status, queue_priority');

      if (cardsError) {
        console.error('Failed to insert diagnostic cards:', cardsError.message);
      } else {
        // Deliver only the first 4 to the client buffer; the rest stay
        // queued and are served through the orchestrator, so the session
        // can adapt mid-flight instead of playing a pre-printed batch.
        insertedCards = (cards || []).slice(0, 4);
        if (insertedCards.length) {
          await supabase
            .from('cards')
            .update({ status: 'delivered' })
            .in('id', insertedCards.map((c: Card) => c.id));
        }
      }
    }

    // ─── Step 5: Queue background compose for more cards ────────────────
    // Even after diagnostic probes, we want AI to start composing
    // deeper personalized cards in the background
    await queueAiRun(supabase, {
      user_id: userId,
      session_id: session.id,
      run_type: 'compose',
      trigger_reason: 'post_diagnostic_compose',
      input_snapshot: {
        onboarding_context: userMind?.onboarding_context || {},
        boundaries: userMind?.boundaries || {},
        language_state: userMind?.language_state || {},
      },
      prompt_version: PROMPT_VERSION,
      schema_version: SCHEMA_VERSION,
    });

    // ─── Step 6: Return response ────────────────────────────────────────
    return new Response(
      JSON.stringify({
        session_id: session.id,
        cards: insertedCards,
        frontier_size: insertedCards.length,
        generated_fresh: filteredRecipes.length < MIN_DIAGNOSTIC_PROBES,
        version: FUNCTION_VERSION,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('start-session error:', message);

    return new Response(
      JSON.stringify({ error: message }),
      {
        status: error instanceof Error && error.message === 'Unauthorized' ? 401 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
