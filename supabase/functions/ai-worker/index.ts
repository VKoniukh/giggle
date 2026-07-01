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
  CARD_MOVES,
  TEMPERATURE_COMPOSE,
  TEMPERATURE_REFLECT,
  TEMPERATURE_STRATEGIC,
  TEMPERATURE_DISTILL,
  estimateCost,
} from '../_shared/constants.ts';
import { buildComposeMissions, queueAiRun } from '../_shared/orchestrator.ts';
import type { AiRun, Thread, Card } from '../_shared/types.ts';

// ─── Prompt Layers (docs/06 §Prompt Architecture) ───────────────────────────
// Order is CRITICAL for caching: static prefix → dynamic suffix

// Layer A: Product Constitution (cached — KEEP AT TOP for prompt caching)
const CONSTITUTION = `You are part of Giggle — a Personal Resonance Engine.

You discover how ONE specific person enters mirth through text. Not jokes. Not humor categories. Not entertainment. You are finding this person's unique RESONANCE FUNCTION.

## What Mirth Actually Is
Mirth is NOT "this is a good joke." It is a SHORT SHIFT IN PERCEPTION:
  expected reality → something breaks it → but the threat is playful → a new order appears → tension becomes pleasure

But there are MANY paths to mirth:
- In a classic joke, incongruity RESOLVES
- In absurdity, it stays UNRESOLVED  
- In cringe, the threat DOESN'T fully disappear
- In dark humor, you get permission to play with the forbidden
- In "жиза" (recognition), there IS no punchline — truth so precise it becomes the punch

## The Laugh Topology Formula
Laugh response = charged_reality × comic_transformation × voice × distance × permission × novelty × current_state

A person doesn't "like office humor." They MIGHT explode when:
  real pain of professional powerlessness
  + corporate formality register
  + absurdly honest human reason underneath  
  + absolutely dry delivery

Same topic, DIFFERENT operation for a different person:
  real pain of professional powerlessness
  + three-step ESCALATION into total chaos
  + each step maintaining formal composure
  + the reader watching the inevitable

SAME TOPIC. DIFFERENT PSYCHIC OPERATION. This is what you mine.

## What You Are NOT
- NOT a joke database or comedy writer
- NOT a genre recommender ("you like sarcasm 38%")
- NOT a psychological profiler
- NOT maximizing similarity to previous winners
- A strong reaction opens a QUESTION and a BRANCH, never repetition

## 7 Deep Layers You Must Distinguish
1. CHARGED NERVES — where psychic energy is stored (powerlessness before systems, social awkwardness, faking adulthood, family closeness AND trauma, migrant alienation, gap between self-image and reality, sex/shame/status, death/fragility, intellectual arrogance, everyday hypocrisy, maintaining dignity in chaos)
2. COMIC OPERATORS — what the text DOES (reinterpret, escalate to absurdity, literalize metaphor, clash registers, name hidden truth, swap power, destroy punchline, compress experience, leave incongruity unresolved, make horror mundane, make mundane cosmically absurd)
3. EMOTIONAL FUEL — what powers it (recognition, relief, tenderness, rebellion, contempt, schadenfreude, shame, self-deprecation, shared helplessness, desperate acceptance)
4. DISTANCE & PERMISSION — too close = hurts, too far = boring, too safe = banal, too dangerous = disgusting. Find the EXACT distance where THIS person's taboo becomes playful
5. VOICE — who speaks matters as much as what's said (exhausted friend, naive child, bureaucrat, dry catastrophe chronicler, over-intellectual neurotic, inner shameful thought, toxic commenter)
6. SOCIAL GEOMETRY — who laughs WITH whom, AT whom, AGAINST whom
7. NOVELTY METABOLISM — how fast patterns saturate, when wildcards are needed

Treat every user model as a PROVISIONAL HYPOTHESIS.`;

// Layer B: Mode Contracts (cached per mode)
const REFLECTOR_CONTRACT = `MODE: REFLECTOR

You analyze evidence and update hypotheses. You do NOT write user-facing texts.

Rules:
✓ Reference specific card IDs as evidence
✓ Always name an alternative explanation for every observation
✓ Search for counterevidence — one heart doesn't prove a stable truth
✓ Separate what worked: the NERVE, the OPERATOR, the VOICE, the FUEL, the DISTANCE
✓ Formulate what to test next as an open question
✓ Consider user's language and cultural context
✓ QUIET USERS: if there are few or no hearts, mine the IMPLICIT signals —
  long dwell / high read-ratio / 'back' events are attention evidence.
  Form weak candidate threads from dwell patterns; a silent user is not
  an empty user

✗ Do NOT make psychological diagnoses
✗ Do NOT turn one hit into stable truth (one heart ≠ "user loves X")
✗ Do NOT invent insights without card evidence
✗ Do NOT generate user-facing texts`;

const COMPOSER_CONTRACT = `MODE: COMPOSER

You generate textual experiments — resonance probes that test specific hypotheses about what makes THIS person laugh.

## LANGUAGE — ABSOLUTE RULE
ALL "text" fields MUST be in the language specified. Metadata (recipe, hypothesis) stays in English.
Violation = system failure.

## What Makes a KILLER Probe

SEMANTIC COMPRESSION — the fewer words, the harder the hit:
  BAD:  "Коли ти працюєш в офісі і розумієш, що ніхто не знає що робить, але всі роблять вигляд"
  GOOD: "На daily сказав, що заблокований. Не став уточнювати, що як особистість."
  WHY: Second one compresses years of experience into 2 sentences. Reader's brain does the work.

HIDDEN RECOGNITION — reader thinks "this is literally me, but I never said it out loud":
  BAD:  "Всі люди іноді відчувають себе самотніми"
  GOOD: "Написав 'лол' і поставив крапку. Це був найчесніший текст за день."
  WHY: First is a greeting card. Second catches a specific micro-behavior that SPECIFIC people recognize.

FRESH CONTAINERS — NOT "a man walks into a bar":
  Use: inner monologue, fake notification, dialogue fragment, confession, fake status update, performance review excerpt, search query, complaint, abandoned message draft, FAQ entry

PSYCHOLOGICALLY CORRECT DISTANCE — the sweet spot where pain becomes playful:
  Too close: "Твоя мама тебе не любила" → hurts
  Too far: "Якась людина десь щось зробила" → boring  
  Just right: "Мама написала 'ми пишаємось тобою' крапка. Без emoji. Ти знаєш що це значить." → reader fills in the emotional gap

## What Makes a BAD Probe
✗ Generic observations anyone could post on social media
✗ AI philosophical language ("In a world where..." / "у світі, де...")
✗ Explanatory punchlines that kill the joke by explaining it
✗ Obvious wordplay or puns
✗ Swapping nouns ("Spring Boot" → "Django" is NOT innovation, same joke different word)
✗ Surface variations of one joke (3 texts about standups = waste)
✗ Copying syntax from previous cards
✗ Writing in wrong language

## Each Candidate MUST
✓ Test a SEPARATE hypothesis (different nerve × different operator × different voice)
✓ Have a clear recipe explaining its construction
✓ Specify expected_learning: what each reaction (heart/skip/stop) would teach us`;

// Layer C: Quality Constitution (cached)
const QUALITY_CONSTITUTION = `QUALITY CONSTITUTION — 10 TYPES OF MIRTH

Your texts should aim for these SPECIFIC states, not "funny" in general:

1. RECOGNITION MIRTH — "Це буквально я." Reader's experience verbalized for the first time.
   Example: "Відкрив нотатки телефону. Там список справ від минулого мене. Половину не можу розшифрувати. Одна каже просто 'НІ'."

2. REINTERPRETATION MIRTH — last phrase forces rebuilding everything read before.
   Example: "Сказав їй що готовий до серйозних стосунків. Вона спитала з ким."

3. NAKED TRUTH MIRTH — someone says what everyone masks. No punchline needed.
   Example: "Як справи? — Я втомився відповідати на це питання чесно, тому нормально."

4. ABSURD CAPITULATION — reality stops making sense and you accept it.
   Example: "Третій день пишу авторизацію. Система працює. Не знаю чому. Боюся дивитись код."

5. LIBERATION MIRTH — permission to touch fear/sex/death/shame without full weight.
   Example: "Лікар сказав що все добре. Тоном, яким кажуть що ще не все погано."

6. SOCIAL CATASTROPHE — cringe. Tension doesn't disappear, becomes deliciously unbearable.
   Example: "Написав 'кохаю' босу замість дружині. Він відповів 'дякую за фідбек'."

7. SUPERIORITY MIRTH — someone exposed as fake/weak/absurd. Powerful but risks toxicity.

8. TENDERNESS MIRTH — human imperfection makes you feel close, not superior.
   Example: "Батько подзвонив спитати як увімкнути VPN. Пояснив що це 'та штука від хакерів'. Увімкнув."

9. LINGUISTIC MIRTH — the word/grammar/register itself becomes the machine.
   Example: "УВАГА: технічні роботи. Просимо вибачення за тимчасові трудності. Менеджмент хаосу."

10. DELAYED MIRTH — strange at first, brain builds the connection seconds later.

COMPRESSION IS EVERYTHING:
- 1-4 sentences maximum  
- Every word must earn its place
- If removing a word doesn't weaken the text — remove it
- The reader's brain completing the thought > spelling it out`;

// Layer D: Static Exemplars (cached — contrastive pairs)
const STATIC_EXEMPLARS = `CONTRASTIVE EXAMPLES — study these to understand quality:

═══ RECOGNITION ═══
BAD: "Всі програмісти ненавидять мітинги і п'ють каву."
WHY BAD: Generic. Could be anyone. No specific pain.

GOOD: "На daily сказав, що заблокований. Не став уточнювати, що як особистість."
WHY GOOD: Specific professional ritual. Formal word "blocked" collides with private truth. 2 sentences. Reader's brain explodes with recognition.

═══ ESCALATION ═══
BAD: "Мітинги — це коли всі говорять і ніхто нічого не робить."
WHY BAD: Observation, not transformation. No escalation. Boring.

GOOD: "На першому daily сказав, що все під контролем. На другому — що працюю над ризиками. На третьому ми вже назвали пожежу трансформаційною ініціативою."
WHY GOOD: Three-step progression. Each step maintains formal composure while reality crumbles. Comedy of escalation, not observation.

═══ TOPIC TRANSFER vs NOUN SWAP ═══
BAD: Previous hit was about standups → write another standup text with different words.
WHY BAD: This is a NOUN SWAP. Same joke, different surface.

GOOD: Hit was about "formal language exposing private disorder at work" → transfer to: "Сказав терапевту що працюю над собою. Вона спитала над чим саме. Я не мав відповіді."
WHY GOOD: The MECHANISM (formal language vs. hidden truth) survives in a completely different WORLD (therapy vs. work).

═══ DISTANCE CALIBRATION ═══
BAD: "Твій батько тебе не любить." → Too direct. Hurts.
BAD: "Батьки бувають різні." → Too far. Boring.

GOOD: "Батько написав 'молодець'. Без знаку оклику. Ти знаєш різницю."
WHY GOOD: Doesn't NAME the emotion. Creates a gap the reader fills with their own experience. Self-inclusive distance.

═══ SEMANTIC COMPRESSION ═══
BAD: "Коли ти приходиш до лікаря і він каже що все нормально але ти бачиш по його обличчю що він просто не хоче тебе лякати і ти виходиш з кабінету не знаючи чи радіти чи плакати"
WHY BAD: 40 words to say what can be said in 12. The reader doesn't need a screenplay.

GOOD: "Лікар сказав що все добре. Тоном, яким кажуть що ще не все погано."
WHY GOOD: 12 words. Same charged reality. Reader's brain fills in EVERYTHING.

═══ AI LANGUAGE ═══
BAD: "У світі, де технології зближують нас, ми ніколи не були такими самотніми."
WHY BAD: This is not humor. This is AI pretending to be deep. Delete immediately.

GOOD: "Маю 847 друзів у фейсбуці. Вчора переїжджав сам."
WHY GOOD: No philosophy. Just two facts. The reader builds the insight.

═══ VOICE MATTERS ═══
BAD: "Робота — це коли ти сидиш і думаєш навіщо все це." (no voice, just generic observation)

GOOD: "Відповідальний за корпоративну культуру повідомляє: п'ятничний дрескод скасовано у зв'язку з тим, що п'ятницю скасовано."
WHY GOOD: VOICE of a bureaucrat. Formal register. The humor is in WHO says it and HOW. The format IS the joke.`;


// ═══════════════════════════════════════════════════════════════════════════════
// Strict Structured Output Schemas (docs/06: "GPT повертає тільки Structured Output")
//
// The thread patch schema IS the whitelist: heat/fatigue/status/version are
// NOT in it, so the model physically cannot touch mechanics-owned fields.
// ═══════════════════════════════════════════════════════════════════════════════

const THREAD_PATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['core', 'mechanism', 'emotional_payoffs', 'working_voices', 'confirmed_contexts', 'contexts_to_try', 'avoid', 'open_question', 'depth'],
  properties: {
    core: { type: ['string', 'null'] },
    mechanism: { type: ['string', 'null'] },
    emotional_payoffs: { type: ['array', 'null'], items: { type: 'string' } },
    working_voices: { type: ['array', 'null'], items: { type: 'string' } },
    confirmed_contexts: { type: ['array', 'null'], items: { type: 'string' } },
    contexts_to_try: { type: ['array', 'null'], items: { type: 'string' } },
    avoid: { type: ['array', 'null'], items: { type: 'string' } },
    open_question: { type: ['string', 'null'] },
    depth: { type: ['integer', 'null'] },
  },
};

const MISSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['move', 'thread_ids', 'purpose', 'target_context', 'semantic_distance'],
  properties: {
    move: { type: 'string', enum: [...CARD_MOVES] },
    thread_ids: { type: 'array', items: { type: 'string' } },
    purpose: { type: 'string' },
    target_context: { type: ['string', 'null'] },
    semantic_distance: { type: ['number', 'null'] },
  },
};

const THREAD_OPERATIONS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['operation', 'thread_id', 'expected_version', 'confidence_delta', 'patch', 'evidence_card_ids'],
    properties: {
      operation: { type: 'string', enum: ['strengthen', 'weaken', 'split', 'merge', 'retire', 'create'] },
      thread_id: { type: ['string', 'null'] },
      expected_version: { type: ['integer', 'null'] },
      confidence_delta: { type: ['number', 'null'] },
      patch: THREAD_PATCH_SCHEMA,
      evidence_card_ids: { type: 'array', items: { type: 'string' } },
    },
  },
};

const REFLECTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['observations', 'thread_operations', 'session_adjustment', 'compose_missions'],
  properties: {
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'evidence_for', 'evidence_against', 'confidence', 'alternative_explanation'],
        properties: {
          claim: { type: 'string' },
          evidence_for: { type: 'array', items: { type: 'string' } },
          evidence_against: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          alternative_explanation: { type: 'string' },
        },
      },
    },
    thread_operations: THREAD_OPERATIONS_SCHEMA,
    session_adjustment: {
      type: 'object',
      additionalProperties: false,
      required: ['novelty_target', 'threads_to_rest', 'avoid_next_moves', 'desired_temperature'],
      properties: {
        novelty_target: { type: ['number', 'null'] },
        threads_to_rest: { type: 'array', items: { type: 'string' } },
        avoid_next_moves: { type: 'array', items: { type: 'string' } },
        desired_temperature: { type: ['number', 'null'] },
      },
    },
    compose_missions: { type: 'array', items: MISSION_SCHEMA },
  },
};

const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reality', 'charged_tension', 'transformation', 'voice', 'emotional_fuel', 'distance', 'format', 'novelty_axis', 'semantic_distance'],
  properties: {
    reality: { type: 'string' },
    charged_tension: { type: 'string' },
    transformation: { type: 'string' },
    voice: { type: 'string' },
    emotional_fuel: { type: 'array', items: { type: 'string' } },
    distance: { type: 'string' },
    format: { type: 'string' },
    novelty_axis: { type: 'string' },
    semantic_distance: { type: 'number' },
  },
};

const COMPOSER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'move', 'source_thread_ids', 'recipe', 'hypothesis_tested', 'expected_learning'],
        properties: {
          text: { type: 'string' },
          move: { type: 'string', enum: [...CARD_MOVES] },
          source_thread_ids: { type: 'array', items: { type: 'string' } },
          recipe: RECIPE_SCHEMA,
          hypothesis_tested: { type: 'string' },
          expected_learning: {
            type: 'object',
            additionalProperties: false,
            required: ['if_heart', 'if_stop_without_heart', 'if_fast_skip'],
            properties: {
              if_heart: { type: 'string' },
              if_stop_without_heart: { type: 'string' },
              if_fast_skip: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const STRATEGIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thread_operations', 'strategic_summary', 'known_anti_patterns', 'unexplored_frontiers', 'compose_missions'],
  properties: {
    thread_operations: THREAD_OPERATIONS_SCHEMA,
    strategic_summary: { type: 'string' },
    known_anti_patterns: { type: 'array', items: { type: 'string' } },
    unexplored_frontiers: { type: 'array', items: { type: 'string' } },
    compose_missions: { type: 'array', items: MISSION_SCHEMA },
  },
};

const DISTILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recipes'],
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['card_id', 'scope', 'cleaned_recipe', 'diagnostic_purpose'],
        properties: {
          card_id: { type: 'string' },
          scope: { type: 'string', enum: ['reusable_exact', 'reusable_recipe', 'personal'] },
          cleaned_recipe: { ...RECIPE_SCHEMA, type: ['object', 'null'] },
          diagnostic_purpose: { type: ['string', 'null'] },
        },
      },
    },
  },
};

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

  // Build prompt: layers A-D (static, cached) + layer E (dynamic)
  const systemPrompt = [
    CONSTITUTION,
    REFLECTOR_CONTRACT,
    QUALITY_CONSTITUTION,
    STATIC_EXEMPLARS,
  ].join('\n\n---\n\n');

  // Layer E: Dynamic User Packet
  const userPrompt = `CURRENT STATE:

Active threads:
${JSON.stringify(ctx.threads.map((t: Thread) => ({
    id: t.id,
    core: t.core,
    mechanism: t.mechanism,
    confidence: t.confidence,
    heat: t.heat,
    fatigue: t.fatigue,
    depth: t.depth,
    status: t.status,
    open_question: t.open_question,
    positive_evidence: t.positive_evidence,
    counter_evidence: t.counter_evidence,
  })), null, 2)}

Recent cards and reactions:
${JSON.stringify(ctx.recentCards.map((c: Card) => {
    const events = ctx.recentEvents.filter((e: { card_id: string }) => e.card_id === c.id);
    return {
      id: c.id,
      text: c.text?.substring(0, 200),
      move: c.move,
      recipe: c.recipe,
      status: c.status,
      reactions: events.map((e: { event_type: string; signal_vector: unknown }) => ({
        type: e.event_type,
        signal: e.signal_vector,
      })),
    };
  }), null, 2)}

Canon exemplars (strongest hits):
${JSON.stringify(ctx.canonCards.map((c: Card) => ({
    id: c.id,
    text: c.text?.substring(0, 200),
    recipe: c.recipe,
  })), null, 2)}

Anti-patterns: ${JSON.stringify(ctx.userMind?.known_anti_patterns || [])}
Strategic summary: ${ctx.userMind?.strategic_summary || 'None yet'}

User language: ${ctx.userMind?.language_state?.primary || 'uk'}
Cultural context: ${ctx.userMind?.language_state?.cultural_context || 'UA'}
Familiar worlds: ${JSON.stringify(ctx.userMind?.onboarding_context?.familiar_worlds || [])}
Boundaries: ${JSON.stringify(ctx.userMind?.boundaries || {})}

Session: ${JSON.stringify(ctx.sessionState || {})}

Trigger reason: ${run.trigger_reason}

Analyze what we've learned from recent reactions.
When creating compose_missions, ensure they specify the user's language (${ctx.userMind?.language_state?.primary || 'uk'}) and respect cultural context.
Return structured JSON.`;

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

  // Map language codes to full names to prevent GPT confusion
  // (e.g., 'uk' could be misread as 'UK English')
  const LANG_NAMES: Record<string, string> = {
    uk: 'Ukrainian (українська)', en: 'English', pl: 'Polish (polski)',
    de: 'German (deutsch)', fr: 'French (français)', es: 'Spanish (español)',
    cs: 'Czech (čeština)', sk: 'Slovak (slovenčina)', ru: 'Russian (русский)',
    pt: 'Portuguese', it: 'Italian', nl: 'Dutch', sv: 'Swedish',
    ro: 'Romanian', hu: 'Hungarian', bg: 'Bulgarian', hr: 'Croatian',
    sr: 'Serbian', lt: 'Lithuanian', lv: 'Latvian', et: 'Estonian',
    tr: 'Turkish', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
    ar: 'Arabic', he: 'Hebrew', hi: 'Hindi', vi: 'Vietnamese',
    th: 'Thai', id: 'Indonesian', fi: 'Finnish', da: 'Danish', no: 'Norwegian',
  };
  const langName = LANG_NAMES[language] || language;

  // Layer E: Dynamic User Packet with missions
  const userPrompt = `═══════════════════════════════════════════
🔴 WRITE ALL "text" FIELDS IN: ${langName}
🔴 Language code: ${language}
🔴 DO NOT write in English, Polish, Russian, or any other language.
🔴 ONLY ${langName}.
═══════════════════════════════════════════

User lives in: ${culturalContext} (this is cultural context for references, NOT the text language!)
Text language is ALWAYS: ${langName}

Familiar worlds: ${JSON.stringify(familiarWorlds)}
Boundaries: ${JSON.stringify(ctx.userMind?.boundaries || {})}
Anti-patterns: ${JSON.stringify(ctx.userMind?.known_anti_patterns || [])}
${safetyBlock}
MISSIONS (one candidate per mission — the mission defines WHAT to test, you define HOW):
${JSON.stringify(missions, null, 2)}

Each candidate must materialize its mission's move and purpose.
Each probe must test a DIFFERENT combination of: charged nerve × comic operator × voice × distance.
Use the user's familiar worlds as context, not genre filter.

Active threads:
${JSON.stringify(ctx.threads.map((t: Thread) => ({
    id: t.id,
    core: t.core,
    mechanism: t.mechanism,
    working_voices: t.working_voices,
    emotional_payoffs: t.emotional_payoffs,
    contexts_to_try: t.contexts_to_try,
    avoid: t.avoid,
    confidence: t.confidence,
    heat: t.heat,
    depth: t.depth,
    version: t.version,
  })), null, 2)}

Canon exemplars:
${JSON.stringify(ctx.canonCards.map((c: Card) => ({
    text: c.text?.substring(0, 200),
    recipe: c.recipe,
  })), null, 2)}

Recent sequence (avoid repetition):
${JSON.stringify(ctx.recentCards.slice(0, 5).map((c: Card) => ({
    move: c.move,
    format: c.format,
    recipe_voice: c.recipe?.voice,
  })), null, 2)}

⚠️ FINAL CHECK: Every "text" value MUST be in ${langName}. NOT English. NOT Polish. NOT Russian. ONLY ${langName}.`;

  const { content, usage } = await callOpenAI(
    model, systemPrompt, userPrompt, COMPOSER_SCHEMA, TEMPERATURE_COMPOSE,
  );
  const estimated = estimateCost(model, usage.input_tokens, usage.output_tokens, usage.cached_tokens);

  // ─── Insert generated cards into frontier ─────────────────────────────
  const candidates = ((content as { candidates?: Array<Record<string, unknown>> }).candidates || [])
    .slice(0, COMPOSE_CANDIDATE_COUNT + 2);
  let cardsCreated = 0;

  // Only thread ids we actually gave the model are valid lineage —
  // hallucinated ids would corrupt staleness checks / break uuid[] casts.
  const knownThreadIds = new Set((ctx.threads as Thread[]).map((t) => t.id));

  for (const [index, candidate] of candidates.entries()) {
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
      text: candidate.text as string,
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
    output: content as Record<string, unknown>,
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
  })), null, 2)}

Session history:
${JSON.stringify(sessions || [], null, 2)}

Current strategic summary: ${ctx.userMind?.strategic_summary || 'None yet'}
Known anti-patterns: ${JSON.stringify(ctx.userMind?.known_anti_patterns || [])}
Unexplored frontiers: ${JSON.stringify(ctx.userMind?.unexplored_frontiers || [])}

User language: ${ctx.userMind?.language_state?.primary || 'uk'}
Cultural context: ${ctx.userMind?.language_state?.cultural_context || 'UA'}
Familiar worlds: ${JSON.stringify(ctx.userMind?.onboarding_context?.familiar_worlds || [])}
Boundaries: ${JSON.stringify(ctx.userMind?.boundaries || {})}

Canon size: ${ctx.canonCards.length}

Provide strategic analysis. Focus on: which threads are real vs accidental, what deeper mechanisms connect them, what's been overexploited, what's untouched.
All compose_missions must specify language: '${ctx.userMind?.language_state?.primary || 'uk'}' and respect boundaries.
Return JSON with thread_operations, updated strategic_summary, updated known_anti_patterns, updated unexplored_frontiers, and compose_missions for next steps.`;

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
