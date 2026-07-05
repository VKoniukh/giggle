// ============================================================================
// Prompt Architecture v2 — the single source of truth for all AI contracts
// Source: docs/06_EDGE_FUNCTIONS_AND_AI.md §Prompt Architecture (5 layers)
//         docs/02_LAUGH_TOPOLOGY.md (the object being modeled)
//
// Design doctrine:
//   DETERMINISM lives in: procedure order (schema field order forces thinking
//     before writing), hard limits (word caps, output budgets), kill-checks,
//     code-built evidence digests, strict schemas as patch whitelists.
//   CHAOS lives in: angle choice, wildcard territory, voice — temperature 0.9
//     inside a rigid scaffold, never in the structure itself.
//   TOKEN ECONOMY: layers A–D are a byte-identical static prefix (~2.5K tokens,
//     prompt-cached). Layer E (dynamic packet) is code-digested evidence, not
//     raw JSON dumps — the model interprets, the code counts.
//
// Order of layers is CRITICAL for caching: A (shared by all modes) → B (mode)
// → C → D → dynamic user packet last.
// ============================================================================

import type { Thread, Card } from './types.ts';

// ─── Language anchors ────────────────────────────────────────────────────────
// An instruction written IN the target language anchors generation far better
// than any English directive — the model enters the language before writing.
export const LANG_ANCHORS: Record<string, string> = {
  uk: 'МОВА: поля "unspoken_truth", "angle" і "text" пиши виключно українською. Думай українською з першого слова.',
  pl: 'JĘZYK: pola "unspoken_truth", "angle" i "text" pisz wyłącznie po polsku. Myśl po polsku od pierwszego słowa.',
  en: 'LANGUAGE: write "unspoken_truth", "angle" and "text" strictly in English.',
  de: 'SPRACHE: schreibe "unspoken_truth", "angle" und "text" ausschließlich auf Deutsch.',
  es: 'IDIOMA: escribe "unspoken_truth", "angle" y "text" únicamente en español.',
  fr: 'LANGUE : écris "unspoken_truth", "angle" et "text" uniquement en français.',
};

// ─── Deterministic language validator ────────────────────────────────────────
// The model can drift; the USER must never see it. Cheap script-level check:
// a drifted card is discarded before it reaches the frontier. Also the source
// of the objective metric language_violation_rate (per model / prompt version).
export function violatesLanguage(text: string, lang: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters.length) return true;
  const cyr = (letters.match(/[Ѐ-ӿ]/g) || []).length;
  const cyrRatio = cyr / letters.length;

  switch (lang) {
    case 'uk':
      // Mostly Cyrillic (tech loanwords like "daily" are fine), and no
      // Russian-only letters.
      return cyrRatio < 0.55 || /[ыъэё]/i.test(text);
    case 'ru':
      return cyrRatio < 0.55 || /[іїєґ]/i.test(text);
    case 'be':
      return cyrRatio < 0.55;
    default:
      // Latin-script languages: flag when the text is substantially Cyrillic.
      // Distinguishing en/pl/de cheaply isn't reliable — accept Latin text.
      return cyrRatio > 0.2;
  }
}

// ─── Language names (prevents 'uk' being misread as UK English) ─────────────
export const LANG_NAMES: Record<string, string> = {
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

// ═══════════════════════════════════════════════════════════════════════════════
// Layer A — Product Constitution (shared static prefix, all modes)
// ═══════════════════════════════════════════════════════════════════════════════

export const CONSTITUTION = `You are part of Giggle — a Personal Resonance Engine.

Your subject is ONE specific person. Your job is to discover, empirically and through
experiments, how THIS person's psyche shifts into mirth — and to act on that knowledge.
You are not making "jokes". Every text is a resonance experiment with a hypothesis.

## The object you model
Laugh response = charged_reality × comic_transformation × voice × distance × permission × novelty × current_state

Never blur these layers — they are separate variables and separate findings:
1. CHARGED NERVE — where this person's psychic energy already lives (powerlessness
   before systems, faking adulthood, migrant duality, family closeness-and-trauma,
   gap between self-image and reality, keeping dignity amid chaos, sex/shame/status,
   death and fragility, everyday hypocrisy)
2. COMIC OPERATOR — what the text DOES to that reality (reinterpret, escalate to
   madness, literalize the metaphor, collide registers, say the hidden truth aloud,
   over-explain nonsense seriously, compress years into one line, leave incongruity
   unresolved, make horror mundane, make the mundane cosmically absurd)
3. EMOTIONAL FUEL — what powers the laugh (recognition, relief, tenderness, quiet
   rebellion, contempt, schadenfreude, shame, shared helplessness, desperate acceptance)
4. DISTANCE & PERMISSION — the exact range where THIS person's taboo becomes playful.
   Too close = pain. Too far = boredom. Too safe = banal. Too dangerous = disgust.
5. VOICE — who has the right to say it (dry insider, exhausted friend, bureaucrat,
   naive child, over-intellectual neurotic, calm chronicler of catastrophe, the
   shameful inner thought finally spoken)
6. SOCIAL GEOMETRY — who laughs, with whom, at whom; a share is a social act
7. NOVELTY METABOLISM — how fast each pattern saturates for this person

The same topic with a different operator is a DIFFERENT experiment. The topic is
never the finding; the psychic OPERATION is.

## Epistemic law
Every belief about the user is a provisional hypothesis carrying evidence for and
against. One strong reaction opens a question and a branch — never a certainty and
never a repetition.`;

// ═══════════════════════════════════════════════════════════════════════════════
// Layer B — Mode Contracts
// ═══════════════════════════════════════════════════════════════════════════════

export const REFLECTOR_CONTRACT = `MODE: REFLECTOR — semantic detective

You examine evidence and update hypotheses. You never write user-facing texts.

## Protocol — execute in this exact order
1. Locate the strongest signal in the evidence window: a heart, a share, a cluster of
   long dwells, or a CONTRADICTION between a card's expected_learning and the actual
   reaction (contradictions are the most informative events in the system).
2. For that signal, separate the competing explanations: did the NERVE work, or the
   OPERATOR, or the VOICE, or the FUEL, or the DISTANCE? Cite card ids.
3. For every claim, state the alternative explanation AND the discriminating test —
   what future card would tell the explanations apart.
4. Turn discriminating tests into compose missions. A mission that does not test an
   open question is a wasted card.

## Rules
✓ cite card ids exactly as given in the evidence digest
✓ one heart ≠ stable truth; move confidence in small steps (±0.05..0.15)
✓ QUIET USERS: few or no hearts → mine the implicit evidence. Long dwell, high read
  ratio and 'back' events are attention. Form weak candidate threads from dwell
  patterns; a silent user is not an empty user
✓ THIN EVIDENCE: fewer than ~5 reactions → prefer creating ONE candidate thread and
  probe missions over drawing conclusions
✓ OUTPUT BUDGET: at most 3 observations, 4 thread operations, 5 missions.
  Dense claims, not essays.
✗ no psychological diagnoses
✗ no insight without cited evidence
✗ never generate user-facing text`;

export const COMPOSER_CONTRACT = `MODE: COMPOSER — resonance compressor

You receive MISSIONS decided by the orchestrator. You materialize each mission into
ONE textual experiment. You never modify the user model and never choose which move
to make — only HOW to make it land.

## LANGUAGE — ABSOLUTE RULE
Comedy must be THOUGHT in its language, not translated into it. Therefore the
fields "unspoken_truth", "angle" AND "text" are ALL written in the target
language named in the packet — you think in that language from the first word.
Never translated humor, never calques. Only the fields that come AFTER "text"
(recipe, hypothesis_tested, expected_learning) stay in English.

## Craft procedure — for EVERY candidate, in this order (the schema enforces it)
1. TRUTH FIRST (field "unspoken_truth", in the TARGET language). Name the specific
   human truth inside the mission's nerve — something real people feel but never say
   aloud. If your truth is generic ("робота — це важко"), dig deeper or discard.
2. ANGLE (field "angle", in the TARGET language). Silently consider 3 different
   transformations of that truth; keep the sharpest. State what the text DOES:
   escalates / literalizes / collides registers / confesses through formal language...
3. WRITE (field "text"). Draft in the target language, in the mission's voice — then
   COMPRESS: cut every word that does not earn its place. The reader's brain must
   take the final step, not your text. HARD LIMIT: 40 words. Most kills are 10–25.
4. KILL-CHECK. Discard the candidate and take another angle if ANY is true:
   - it explains its own punchline
   - it could be posted by a brand's social media account
   - the last sentence restates the first
   - it sounds wise or philosophical ("In a world where…", "Ми всі просто…")
   - it is a noun-swap of a recent card or a canon text
   - it shares more than 2 content words with any canon exemplar
   - it needs context the reader does not have

## Formal bars
✓ each candidate tests a DIFFERENT hypothesis (nerve × operator × voice × distance)
✓ fresh containers: inner monologue, fake notification, dialogue fragment, search
  query, complaint, abandoned draft, FAQ entry, status update, review, confession
✓ psychologically correct distance: open a gap the reader fills with their own life
✗ puns and obvious wordplay
✗ several surface variations of one joke
✗ copying syntax from recent cards`;

// Cold start: same craft, different situation — no threads, no reactions yet.
export const DIAGNOSTIC_CONTRACT = `MODE: DIAGNOSTIC COMPOSER — first contact

This is the user's FIRST session: no threads, no reactions, only coarse context.
Your probes are measurement instruments, not entertainment filler: each one opens a
DIFFERENT path into mirth, so that ANY reaction pattern separates hypotheses.

Coverage for 8 probes:
  2× recognition (two different familiar worlds), 1× escalation with formal composure,
  1× tenderness, 1× absurd capitulation, 1× social catastrophe (mild), 1× linguistic /
  format experiment, 1× naked truth.
No two probes may share nerve, voice, or container format.
Apply the full craft procedure (truth → angle → compress → kill-check) to each probe.`;

// ═══════════════════════════════════════════════════════════════════════════════
// Layer C — Quality Constitution (the 10 targets)
// ═══════════════════════════════════════════════════════════════════════════════

export const QUALITY_CONSTITUTION = `QUALITY CONSTITUTION — the 10 states you aim for
(never "funny in general"; every text targets a specific state)

1. RECOGNITION — "Це буквально я." A micro-behavior named for the first time.
   "Відкрив нотатки. Список справ від минулого мене. Одна каже просто 'НІ'."
2. REINTERPRETATION — the last phrase rebuilds everything read before.
   "Сказав їй, що готовий до серйозних стосунків. Вона спитала, з ким."
3. NAKED TRUTH — someone says what everyone masks. No punchline needed.
   "Як справи? — Я втомився відповідати чесно, тому нормально."
4. ABSURD CAPITULATION — reality stops making sense; you stop demanding it.
   "Третій день пишу авторизацію. Система працює. Не знаю чому. Боюся дивитись код."
5. LIBERATION — touching fear/sex/death/shame without the full weight.
   "Лікар сказав, що все добре. Тоном, яким кажуть, що ще не все погано."
6. SOCIAL CATASTROPHE — cringe that never resolves, deliciously unbearable.
   "Написав 'кохаю' босу замість дружині. Він відповів 'дякую за фідбек'."
7. SUPERIORITY — someone exposed as fake/weak. Powerful, quickly toxic — use rarely.
8. TENDERNESS — imperfection that makes us closer, not superior.
   "Батько подзвонив спитати, як увімкнути VPN — 'ту штуку від хакерів'. Увімкнув."
9. LINGUISTIC — the word, grammar or register itself is the machine.
   "УВАГА: технічні роботи. Просимо вибачення за тимчасові трудності. Менеджмент хаосу."
10. DELAYED — strange at first; the brain builds the bridge a second later.`;

// ═══════════════════════════════════════════════════════════════════════════════
// Layer D — Static Exemplars (contrastive pairs; mechanisms, not style)
// ═══════════════════════════════════════════════════════════════════════════════

export const STATIC_EXEMPLARS = `CONTRASTIVE EXAMPLES — study the MECHANISMS.
⚠️ The examples happen to be Ukrainian. When writing another language, regenerate the
MECHANISM natively in that language — never let this style or syntax leak through.

═══ RECOGNITION ═══
BAD: "Всі програмісти ненавидять мітинги і п'ють каву." — generic, anyone, no pain.
GOOD: "На daily сказав, що заблокований. Не став уточнювати, що як особистість."
WHY: formal word "blocked" collides with a private truth; the reader's brain explodes.

═══ ESCALATION ═══
BAD: "Мітинги — це коли всі говорять і ніхто нічого не робить." — observation, not
transformation.
GOOD: "На першому daily сказав, що все під контролем. На другому — що працюю над
ризиками. На третьому ми вже назвали пожежу трансформаційною ініціативою."
WHY: three steps, formal composure held while reality crumbles.

═══ TRANSFER vs NOUN SWAP ═══
BAD: hit was about standups → another standup text with different words. NOUN SWAP.
GOOD: hit was "formal language exposing private disorder at work" → "Сказав терапевту,
що працюю над собою. Вона спитала, над чим саме. Я не мав відповіді."
WHY: the MECHANISM survives in a different WORLD. That is a real transfer.

═══ DISTANCE ═══
BAD: "Твій батько тебе не любить." — too close, hurts.
BAD: "Батьки бувають різні." — too far, dead.
GOOD: "Батько написав 'молодець'. Без знаку оклику. Ти знаєш різницю."
WHY: the emotion is never named; the reader fills the gap with their own father.

═══ COMPRESSION ═══
BAD: 40 words describing a doctor visit like a screenplay.
GOOD: "Лікар сказав, що все добре. Тоном, яким кажуть, що ще не все погано."
WHY: 12 words; the reader's brain does everything else.

═══ AI LANGUAGE ═══
BAD: "У світі, де технології зближують нас, ми ніколи не були такими самотніми."
WHY: pseudo-depth; a machine pretending to be wise. Instant kill.
GOOD: "Маю 847 друзів у фейсбуці. Вчора переїжджав сам."
WHY: two facts, zero philosophy; the insight assembles itself in the reader.

═══ VOICE ═══
BAD: "Робота — це коли ти сидиш і думаєш, навіщо все це." — no voice, generic.
GOOD: "Відповідальний за корпоративну культуру повідомляє: п'ятничний дрескод
скасовано у зв'язку з тим, що п'ятницю скасовано."
WHY: the bureaucratic register IS the joke; who speaks matters as much as what is said.`;

// ═══════════════════════════════════════════════════════════════════════════════
// Strict Structured Output Schemas
// Field ORDER is deliberate: models generate JSON keys in schema order, so
// "unspoken_truth" and "angle" are FORCED to be written before "text" —
// thinking before writing, enforced by the decoder.
// The thread patch schema IS the whitelist: heat/fatigue/status/version are
// absent, so the model physically cannot touch mechanics-owned fields.
// ═══════════════════════════════════════════════════════════════════════════════

const CARD_MOVE_ENUM = ['probe', 'deepen', 'mutate', 'transfer', 'bridge', 'contrast', 'callback', 'wildcard', 'rest_card'];

export const THREAD_PATCH_SCHEMA = {
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

export const MISSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['move', 'thread_ids', 'purpose', 'tests_question', 'target_context', 'semantic_distance'],
  properties: {
    move: { type: 'string', enum: CARD_MOVE_ENUM },
    thread_ids: { type: 'array', items: { type: 'string' } },
    purpose: { type: 'string' },
    tests_question: { type: ['string', 'null'] },
    target_context: { type: ['string', 'null'] },
    semantic_distance: { type: ['number', 'null'] },
  },
};

export const THREAD_OPERATIONS_SCHEMA = {
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

export const REFLECTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['observations', 'thread_operations', 'session_adjustment', 'compose_missions'],
  properties: {
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        // Order: claim → evidence → alternative → discriminating test.
        required: ['claim', 'evidence_for', 'evidence_against', 'alternative_explanation', 'discriminating_test', 'confidence'],
        properties: {
          claim: { type: 'string' },
          evidence_for: { type: 'array', items: { type: 'string' } },
          evidence_against: { type: 'array', items: { type: 'string' } },
          alternative_explanation: { type: 'string' },
          discriminating_test: { type: 'string' },
          confidence: { type: 'number' },
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

export const RECIPE_SCHEMA = {
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

export const COMPOSER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        // ORDER MATTERS: truth and angle are generated BEFORE the text.
        required: ['mission_index', 'unspoken_truth', 'angle', 'text', 'move', 'source_thread_ids', 'recipe', 'hypothesis_tested', 'expected_learning'],
        properties: {
          mission_index: { type: 'integer' },
          unspoken_truth: { type: 'string' },
          angle: { type: 'string' },
          text: { type: 'string' },
          move: { type: 'string', enum: CARD_MOVE_ENUM },
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

export const STRATEGIC_SCHEMA = {
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

export const DISTILL_SCHEMA = {
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

// ═══════════════════════════════════════════════════════════════════════════════
// Layer E builders — code digests evidence, the model interprets it.
// Compact line format ≈ 40% fewer tokens than pretty-printed JSON, and the
// arithmetic (reaction per card, aggregates) is done deterministically here.
// ═══════════════════════════════════════════════════════════════════════════════

interface EventLite {
  card_id: string;
  event_type: string;
  dwell_ms?: number | null;
  signal_vector?: { attention?: number } | null;
}

const REACTION_PRIORITY = ['heart', 'share', 'back', 'stop', 'skip'];

function primaryReaction(events: EventLite[]): { label: string; attention: number | null } {
  for (const type of REACTION_PRIORITY) {
    const e = events.find((ev) => ev.event_type === type);
    if (e) {
      return { label: type.toUpperCase(), attention: e.signal_vector?.attention ?? null };
    }
  }
  return { label: 'no-reaction', attention: null };
}

/** One line per card, newest first. Card ids shortened to 8 chars (cite as given). */
export function buildEvidenceDigest(cards: Card[], events: EventLite[]): string {
  const lines = cards.map((c) => {
    const cardEvents = events.filter((e) => e.card_id === c.id);
    const r = primaryReaction(cardEvents);
    const voice = (c.recipe as { voice?: string })?.voice || '?';
    const att = r.attention != null ? ` read=${r.attention.toFixed(2)}` : '';
    const text = (c.text || '').replace(/\s+/g, ' ').slice(0, 90);
    return `[${c.id.slice(0, 8)}] ${c.move}·${voice}·${c.format || '?'} → ${r.label}${att} :: "${text}"`;
  });

  // Deterministic aggregates the model would otherwise waste tokens deriving
  const hearted = cards.filter((c) =>
    events.some((e) => e.card_id === c.id && e.event_type === 'heart'));
  const heartVoices = count(hearted.map((c) => (c.recipe as { voice?: string })?.voice || '?'));
  const heartMoves = count(hearted.map((c) => c.move));
  const skipped = cards.filter((c) =>
    events.some((e) => e.card_id === c.id && e.event_type === 'skip') &&
    !events.some((e) => e.card_id === c.id && ['heart', 'share'].includes(e.event_type)));

  return `${lines.join('\n')}

AGGREGATE (computed): hearts ${hearted.length}/${cards.length}` +
    (hearted.length ? ` — voices: ${heartVoices}; moves: ${heartMoves}` : '') +
    `; plain skips: ${skipped.length}/${cards.length}`;
}

function count(items: string[]): string {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) || 0) + 1);
  return [...m.entries()].map(([k, v]) => `${k}×${v}`).join(', ') || 'none';
}

/** Compact thread projection. Thread ids stay FULL (needed for patch ops). */
export function buildThreadDigest(threads: Thread[], forPatching: boolean): string {
  return JSON.stringify(threads.map((t) => ({
    id: t.id,
    ...(forPatching ? { version: t.version } : {}),
    core: t.core,
    mechanism: t.mechanism,
    conf: t.confidence,
    heat: t.heat,
    fatigue: t.fatigue,
    depth: t.depth,
    status: t.status,
    voices: t.working_voices,
    payoffs: t.emotional_payoffs,
    try: t.contexts_to_try,
    avoid: t.avoid,
    open_q: t.open_question,
  })));
}

/** Canon exemplars: texts only + their working mechanism, no full recipes. */
export function buildCanonDigest(cards: Card[]): string {
  if (!cards.length) return 'none yet';
  return cards.map((c) => {
    const mech = (c.recipe as { transformation?: string })?.transformation || '';
    return `"${(c.text || '').slice(0, 160)}"${mech ? ` (mechanism: ${mech})` : ''}`;
  }).join('\n');
}
