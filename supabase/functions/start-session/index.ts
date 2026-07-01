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
  estimateCost,
} from '../_shared/constants.ts';
import type { RhythmState, Card, QualityRecipe } from '../_shared/types.ts';


// ─── Diagnostic Probe Generator Prompt ──────────────────────────────────────
// docs/03: "Ортогональні проби: одна тема — різні механізми,
//            один механізм — різні теми"
// docs/02: 7 deep layers, 10 mirth types, 12+ comic operators

const DIAGNOSTIC_SYSTEM_PROMPT = `You generate diagnostic text probes for Giggle — a Personal Resonance Engine.

## ABSOLUTE RULE: LANGUAGE
ALL probe texts MUST be written ENTIRELY in the language specified by the user.
Metadata (recipe, diagnostic_purpose, expected_learning) stays in English.
Violation of this rule = complete system failure.

## What Are Diagnostic Probes
These are the FIRST texts a new user sees. They are NOT random jokes. NOT "funny content."
They are ORTHOGONAL RESONANCE PROBES — designed to maximally differentiate humor profiles.

Each probe tests a DIFFERENT combination from the Laugh Topology:
  charged_reality × comic_transformation × voice × distance × emotional_fuel

## The 10 Types of Mirth You Must Cover
1. RECOGNITION — "Це буквально я." Truth the reader never verbalized.
2. REINTERPRETATION — last phrase forces rebuilding everything read before.
3. NAKED TRUTH — someone says what everyone masks. No punchline needed.
4. ABSURD CAPITULATION — reality stops making sense. You accept it.
5. LIBERATION — permission to touch fear/sex/death/shame without full weight.
6. SOCIAL CATASTROPHE — cringe that doesn't resolve. Deliciously unbearable.
7. SUPERIORITY — someone exposed. Powerful but risks toxicity.
8. TENDERNESS — human imperfection makes you feel close, not superior.
9. LINGUISTIC — the word/grammar/register itself IS the machine.
10. DELAYED — strange at first. Brain builds the connection seconds later.

## What Makes a KILLER Probe
SEMANTIC COMPRESSION — say MORE with FEWER words (1-4 sentences MAX):
  BAD:  "Коли ти працюєш в офісі і розумієш, що ніхто не знає що робить, але всі роблять вигляд"
  GOOD: "На daily сказав, що заблокований. Не став уточнювати, що як особистість."
  WHY: 2 sentences compress years of experience. Reader's brain does the work.

HIDDEN RECOGNITION — reader thinks "this is literally me":
  BAD:  "Всі люди іноді відчувають себе самотніми"  
  GOOD: "Написав 'лол' і поставив крапку. Це був найчесніший текст за день."

FRESH CONTAINERS — NOT "a man walks into a bar":
  Use: inner monologue, fake notification, dialogue, confession, search query, complaint, FAQ entry, performance review, abandoned draft

CORRECT DISTANCE — sweet spot where pain becomes playful:
  Too close: "Твоя мама тебе не любила" → hurts
  Too far: "Якась людина десь щось зробила" → boring
  Right: "Мама написала 'ми пишаємось тобою'. Крапка. Без emoji. Ти знаєш що це значить."

## BAD Probe Examples (AVOID)
✗ "Programmers have two problems: naming things and off-by-one errors" — generic, no pain
✗ "У світі, де технології зближують нас..." — AI philosophical language. Delete.
✗ "Робота — це коли всі роблять вигляд" — observation without transformation
✗ Any text where removing it from the set changes nothing about the diagnosis

## GOOD Probe Examples (STUDY THESE)
"На першому daily сказав, що все під контролем. На другому — що працюю над ризиками. На третьому ми вже назвали пожежу трансформаційною ініціативою."
→ Escalation. 3-step progression. Formal composure crumbling.

"Лікар сказав що все добре. Тоном, яким кажуть що ще не все погано."
→ Liberation mirth. 12 words. Reader fills in everything.

"Батько подзвонив спитати як увімкнути VPN. Пояснив що це 'та штука від хакерів'. Увімкнув."
→ Tenderness. No judgment. The imperfection IS the love.

"Написав 'кохаю' босу замість дружині. Він відповів 'дякую за фідбек'."
→ Social catastrophe. The cringe ESCALATES because the response is professional.

"Відповідальний за корпоративну культуру повідомляє: п'ятничний дрескод скасовано у зв'язку з тим, що п'ятницю скасовано."
→ Voice IS the joke. Bureaucratic register. Format as comedy.

"Маю 847 друзів у фейсбуці. Вчора переїжджав сам."
→ Two facts. No philosophy. Reader builds the insight.`;


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
      .select('user_id, onboarding_completed, language_state, boundaries, onboarding_context')
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

      // Queue strategic reflection for the closed sessions
      const aiRunsToQueue = staleSessions.map(s => ({
        user_id: userId,
        session_id: s.id,
        run_type: 'strategic_reflect',
        status: 'queued',
        trigger_reason: 'session_end_lazy_evaluation',
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
      }));
      
      await supabase.from('ai_runs').insert(aiRunsToQueue);
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

    // ─── Step 1.5: Check for pre-generated cards ────────────────────────
    // language.tsx triggers cold_start_compose during onboarding step 1.
    // By the time user reaches feed (~20-30 sec later), cards may already
    // be generated and waiting. Use them → instant first card.
    // IMPORTANT: only use cards matching current language!
    const userLanguage = userMind?.language_state?.primary || 'uk';

    const { data: preGenerated } = await supabase
      .from('cards')
      .select('id, text, format, move, recipe, status, queue_priority')
      .eq('user_id', userId)
      .eq('status', 'queued')
      .eq('language', userLanguage)
      .order('queue_priority', { ascending: false })
      .limit(12);

    if (preGenerated && preGenerated.length >= 3) {
      // Pre-generated cards exist! Assign them to this session.
      await supabase
        .from('cards')
        .update({ session_id: session.id })
        .eq('user_id', userId)
        .eq('status', 'queued')
        .eq('language', userLanguage)
        .is('session_id', null);

      // Still queue a background compose for more cards
      await supabase.from('ai_runs').insert({
        user_id: userId,
        session_id: session.id,
        run_type: 'compose',
        status: 'queued',
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
          cards: preGenerated,
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

      // Map language codes to full names to prevent GPT confusion
      const LANG_NAMES: Record<string, string> = {
        uk: 'Ukrainian (українська)', en: 'English', pl: 'Polish (polski)',
        de: 'German (deutsch)', fr: 'French (français)', es: 'Spanish (español)',
        cs: 'Czech (čeština)', sk: 'Slovak (slovenčina)', ru: 'Russian (русский)',
        pt: 'Portuguese', it: 'Italian', nl: 'Dutch', sv: 'Swedish',
        ro: 'Romanian', hu: 'Hungarian', bg: 'Bulgarian', hr: 'Croatian',
        tr: 'Turkish', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
      };
      const langCode = languageState.primary || 'uk';
      const langName = LANG_NAMES[langCode] || langCode;

      const userPrompt = `═══════════════════════════════════════════
🔴 WRITE ALL "text" FIELDS IN: ${langName}
🔴 DO NOT write in English, Polish, Russian, or any other language.
🔴 ONLY ${langName}.
═══════════════════════════════════════════

Generate 8 diagnostic resonance probes for a new user.

USER CONTEXT:
- User lives in: ${languageState.cultural_context || 'UA'} (for cultural references ONLY, NOT the text language!)
- Text language: ${langName}
- Familiar worlds: ${JSON.stringify(onboardingContext.familiar_worlds || ['not specified'])}
- Life context hints: ${JSON.stringify(onboardingContext.life_context_hints || [])}
- Allowed topics: ${JSON.stringify(boundaries.allowed || ['all'])}
- Restricted topics (use carefully): ${JSON.stringify(boundaries.restricted || [])}
- Forbidden topics (NEVER touch): ${JSON.stringify(boundaries.forbidden || [])}

REQUIREMENTS:
1. EVERY "text" field MUST be in ${langName}
2. Each probe tests a DIFFERENT dimension (different nerve + different operator + different voice)
3. Respect forbidden boundaries ABSOLUTELY
4. Use familiar worlds as CONTEXT, not as genre filter
5. Mix: 2 recognition probes, 2 mechanism probes, 1 tenderness, 1 absurdity, 1 social catastrophe, 1 linguistic/format experiment
6. Each text should be 1-4 sentences max (semantic compression!)
7. recipe, diagnostic_purpose, expected_learning can be in English

Return JSON:
{
  "probes": [
    {
      "text": "THE ACTUAL TEXT IN ${langName}",
      "format": "inner_monologue | dialogue | fake_notification | commentary | confession | ...",
      "recipe": {
        "charged_tension": "what reality this touches",
        "transformation": "what comic operator is used",
        "voice": "who is speaking",
        "emotional_fuel": ["recognition", "relief", ...],
        "distance": "self-inclusive | observational | intimate | cosmic",
        "novelty_axis": "what makes this different from the others"
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

⚠️ FINAL CHECK: Every "text" value MUST be in ${langName}. NOT English. NOT Polish. NOT Russian. ONLY ${langName}.`;

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
            model: Deno.env.get('GIGGLE_MODEL_COMPOSE') || 'gpt-4o-mini',
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
        const usedModel = Deno.env.get('GIGGLE_MODEL_COMPOSE') || 'gpt-4o-mini';
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

        // Transform AI output into card records
        diagnosticCards = probes.map(
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
        insertedCards = cards || [];
      }
    }

    // ─── Step 5: Queue background compose for more cards ────────────────
    // Even after diagnostic probes, we want AI to start composing
    // deeper personalized cards in the background
    const { error: runError } = await supabase
      .from('ai_runs')
      .insert({
        user_id: userId,
        session_id: session.id,
        run_type: 'compose',
        status: 'queued',
        trigger_reason: 'post_diagnostic_compose',
        input_snapshot: {
          onboarding_context: userMind?.onboarding_context || {},
          boundaries: userMind?.boundaries || {},
          language_state: userMind?.language_state || {},
        },
        prompt_version: PROMPT_VERSION,
        schema_version: SCHEMA_VERSION,
      });

    if (runError) {
      console.error('Failed to queue background compose:', runError.message);
    }

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
