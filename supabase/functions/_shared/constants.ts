// ============================================================================
// Shared Constants for Giggle Edge Functions
// Source: docs/06_EDGE_FUNCTIONS_AND_AI.md — tactical reactions, trigger conditions
// Source: docs/04_ORCHESTRATION.md — hard constraints
// ============================================================================

// ─── Versioning ──────────────────────────────────────────────────────────────
export const FUNCTION_VERSION = '1.0.0';
// v2 = scaffolded craft prompts (truth→angle→text), evidence digests,
// discriminating tests. Bump on every prompt change — ai_runs.prompt_version
// makes resonance_rate(v1) vs resonance_rate(v2) directly measurable.
export const PROMPT_VERSION = 'v2';
export const SCHEMA_VERSION = 'v2';

// ─── AI Models (configurable, not hardcoded) ────────────────────────────────
// Override via env vars GIGGLE_MODEL_COMPOSE / GIGGLE_MODEL_REFLECT
export const MODEL_COMPOSE = Deno.env.get('GIGGLE_MODEL_COMPOSE') || 'gpt-4.1-mini';
export const MODEL_REFLECT = Deno.env.get('GIGGLE_MODEL_REFLECT') || 'gpt-4.1-mini';
// Strategic reflection uses the stronger model only for deep analysis (rare calls)
export const MODEL_STRATEGIC = Deno.env.get('GIGGLE_MODEL_STRATEGIC') || 'gpt-4.1-mini';

// ─── Tactical Deltas (docs/06 §record-signal) ──────────────────────────────
// Applied deterministically after each signal. No GPT involved.

export const HEAT_DELTA_HEART = 0.10;
export const FATIGUE_DELTA_HEART = 0.04;
export const NOVELTY_DEBT_DELTA_HEART = 0.05;

export const HEAT_DELTA_SKIP = -0.03; // small local penalty
export const HEAT_DELTA_SHARE = 0.05; // share is separate axis, mild heat

// Novelty debt is REPAID when the orchestrator actually shows something novel.
// docs/04: "✓ погашати novelty debt" — the debt must decrease, not only grow.
export const NOVELTY_REPAYMENT: Record<string, number> = {
  wildcard: 0.20,
  transfer: 0.10,
  bridge: 0.10,
  probe: 0.08,
  contrast: 0.06,
};

// ─── Hard Constraints (docs/04 §Hard Constraints, docs/06 §next-card) ──────
// These are enforced by code, NOT by AI.

export const MAX_SAME_THREAD_CONSECUTIVE = 2;
export const MAX_SAME_FORMAT_IN_5 = 3;
export const MIN_FRONTIER_SIZE = 3;
export const MIN_CALLBACK_PAUSE_CARDS = 5; // at least 5 other cards before callback

// ─── Fatigue & Retirement Thresholds ────────────────────────────────────────
export const FATIGUE_THRESHOLD_RESTING = 0.7;
export const HEAT_THRESHOLD_RETIRED = 0.2;
export const CONFIDENCE_THRESHOLD_RETIRED = 0.4;

// ─── Trigger Conditions (docs/06 §Trigger Conditions) ───────────────────────

// Reflection triggers
export const REFLECTION_TRIGGER_HEARTS_IN_5 = 2;    // 2 hearts among last 5 cards
export const REFLECTION_TRIGGER_CARDS_SINCE = 12;     // 10-12 cards after last reflection (was 8 — too frequent)

// Composition triggers
export const COMPOSE_TRIGGER_FRONTIER_MIN = 3;        // ready frontier < 3

// Strategic reflection triggers
export const STRATEGIC_TRIGGER_SESSIONS = 3;           // 3 completed sessions
export const STRATEGIC_TRIGGER_SHOWN = 50;             // 30-50 shown cards (using 50)
export const STRATEGIC_TRIGGER_CANON = 5;              // 5 new canon cards

// ─── Prompt Window (docs/06 §Cost Control) ──────────────────────────────────
// "В prompt передається не вся історія"
export const REFLECTION_CARD_WINDOW = 12;   // last 8-15 shown cards (using 12 — saves tokens)
export const CANON_EXEMPLAR_COUNT = 4;       // 3-6 canonical texts (using 4 — saves tokens)
// docs/06 §Cost Control: "1 composition call генерує 5–8 кандидатів".
// The static prompt prefix dominates input cost, so more candidates per call
// = lower cost per card (~20% cheaper than 4 per call).
export const COMPOSE_CANDIDATE_COUNT = 6;

// ─── AI Temperatures (per mode) ─────────────────────────────────────────────
// Reflection is ANALYSIS — low temperature. Composition is CREATION — high:
// the craft scaffold (truth→angle→compress→kill-check) holds the structure,
// so temperature buys wild ANGLES, not broken form. Chaos in content,
// determinism in procedure.
export const TEMPERATURE_COMPOSE = 0.9;
export const TEMPERATURE_REFLECT = 0.3;
export const TEMPERATURE_STRATEGIC = 0.4;
export const TEMPERATURE_DISTILL = 0.3;

// ─── Event Types ────────────────────────────────────────────────────────────
export const EVENT_TYPES = ['impression', 'stop', 'skip', 'heart', 'share', 'back'] as const;
export type EventType = typeof EVENT_TYPES[number];

// ─── Card Moves (docs/04 §9 операцій) ───────────────────────────────────────
export const CARD_MOVES = ['probe', 'deepen', 'mutate', 'transfer', 'bridge', 'contrast', 'callback', 'wildcard', 'rest_card'] as const;
export type CardMove = typeof CARD_MOVES[number];

// ─── Card Statuses ──────────────────────────────────────────────────────────
// 'delivered' = sent to the client buffer; 'shown' = client reported impression.
// This keeps shown_at honest: analytics and the Reflector see what the user
// actually SAW, in the order they saw it — not the prefetch order.
export const CARD_STATUSES = ['candidate', 'queued', 'delivered', 'shown', 'discarded', 'hearted'] as const;
export type CardStatus = typeof CARD_STATUSES[number];

// ─── Thread Statuses ────────────────────────────────────────────────────────
export const THREAD_STATUSES = ['candidate', 'active', 'resting', 'dormant', 'retired'] as const;
export type ThreadStatus = typeof THREAD_STATUSES[number];

// ─── AI Run Types ───────────────────────────────────────────────────────────
export const RUN_TYPES = ['cold_start_compose', 'reflect', 'compose', 'strategic_reflect', 'distill_quality'] as const;
export type RunType = typeof RUN_TYPES[number];

// ─── AI Run Statuses ────────────────────────────────────────────────────────
export const RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'conflict'] as const;
export type RunStatus = typeof RUN_STATUSES[number];

// ─── Token Pricing (for estimated_cost calculation) ─────────────────────────
// docs/05 §Token Economics: "estimated_cost рахувати на момент запису"
// Prices per 1M tokens, updated when pricing changes
// cached_input = 50% of input price (OpenAI prompt caching)
export const TOKEN_PRICING: Record<string, { input: number; output: number; cached_input: number }> = {
  'gpt-4o-mini':   { input: 0.15,  output: 0.60,  cached_input: 0.075 },
  'gpt-4.1-mini':  { input: 0.40,  output: 1.60,  cached_input: 0.20  },
  'gpt-4.1':       { input: 2.00,  output: 8.00,  cached_input: 1.00  },
  'gpt-5.4-mini':  { input: 0.75,  output: 4.50,  cached_input: 0.375 },
  'gpt-5.4':       { input: 2.50,  output: 15.00, cached_input: 1.25  },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0,
): number {
  const pricing = TOKEN_PRICING[model];
  if (!pricing) return 0;
  // Non-cached input tokens = total input - cached
  const freshInputTokens = Math.max(0, inputTokens - cachedTokens);
  return (
    freshInputTokens * pricing.input +
    cachedTokens * pricing.cached_input +
    outputTokens * pricing.output
  ) / 1_000_000;
}
