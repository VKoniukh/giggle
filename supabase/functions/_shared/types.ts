// ============================================================================
// TypeScript Types for Giggle Database Tables
// Source: docs/05_DATA_ARCHITECTURE.md — full table schemas
// Source: supabase/migrations/000_init_tables.sql — authoritative DDL
// ============================================================================

// ─── user_minds (§1) ────────────────────────────────────────────────────────

export interface OnboardingContext {
  familiar_worlds: string[];
  language?: string;
  life_context_hints?: string[];
}

export interface Boundaries {
  allowed: string[];
  restricted: string[];
  forbidden: string[];
}

export interface LanguageState {
  primary: string;         // e.g. 'uk', 'en', 'pl'
  cultural_context: string; // e.g. 'UA', 'US', 'PL'
  preferred_register?: string;
}

export interface UserMind {
  user_id: string;
  onboarding_context: OnboardingContext;
  boundaries: Boundaries;
  language_state: LanguageState;
  strategic_summary: string | null;
  known_anti_patterns: string[];
  unexplored_frontiers: string[];
  onboarding_completed: boolean;
  profile_version: number;
  last_reflection_at: string | null;
  last_strategic_reflection_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── sessions (§2) ──────────────────────────────────────────────────────────

export interface RhythmState {
  recent_moves: string[];
  recent_thread_ids: string[];
  current_temperature: number;
  novelty_debt: number;
  risk_budget: number;
  intensity: number;
  formats_recently_used: string[];
  voices_recently_used?: string[];
  threads_to_rest: string[];
}

export interface Session {
  id: string;
  user_id: string;
  status: 'active' | 'ended';
  started_at: string;
  ended_at: string | null;
  rhythm_state: RhythmState;
  cards_shown: number;
  strong_signals: number;
  cards_since_reflection: number;
  session_version: number;
}

// ─── threads (§3) ───────────────────────────────────────────────────────────

export type ThreadStatus = 'candidate' | 'active' | 'resting' | 'dormant' | 'retired';

export interface Thread {
  id: string;
  user_id: string;
  core: string;
  mechanism: string;
  emotional_payoffs: string[];
  working_voices: string[];
  confirmed_contexts: string[];
  contexts_to_try: string[];
  avoid: string[];
  open_question: string | null;
  confidence: number;
  heat: number;
  fatigue: number;
  depth: number;
  positive_evidence: string[];
  counter_evidence: string[];
  status: ThreadStatus;
  version: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── cards (§4) ─────────────────────────────────────────────────────────────

export type CardMove = 'probe' | 'deepen' | 'mutate' | 'transfer' | 'bridge' | 'contrast' | 'callback' | 'wildcard' | 'rest_card';
export type CardStatus = 'candidate' | 'queued' | 'delivered' | 'shown' | 'discarded' | 'hearted';
export type CardScope = 'personal' | 'reusable_exact' | 'reusable_recipe' | 'global_probe';

export interface CardRecipe {
  reality?: string;
  charged_tension?: string;
  transformation?: string;
  voice?: string;
  emotional_fuel?: string[];
  distance?: string;
  format?: string;
  novelty_axis?: string;
  semantic_distance?: number;
}

export interface ExpectedLearning {
  if_heart: string;
  if_stop_without_heart: string;
  if_fast_skip: string;
}

export interface Card {
  id: string;
  user_id: string | null;
  session_id: string | null;
  text: string;
  language: string;
  format: string | null;
  move: CardMove;
  recipe: CardRecipe;
  hypothesis_tested: string | null;
  expected_learning: ExpectedLearning | null;
  source_thread_ids: string[] | null;
  source_thread_versions: Record<string, number> | null;
  parent_card_ids: string[] | null;
  generated_by_run_id: string | null;
  status: CardStatus;
  queue_priority: number;
  scope: CardScope;
  quality_state: string | null;
  shown_at: string | null;
  created_at: string;
}

// ─── events (§5) ────────────────────────────────────────────────────────────

export type EventType = 'impression' | 'stop' | 'skip' | 'heart' | 'share' | 'back';

export interface SignalVector {
  attention: number;
  mirth: number;
  identity_resonance: number;
  social_utility: number;
  rejection: number;
  slow_burn_probability: number;
}

export interface GiggleEvent {
  id: string;
  user_id: string;
  session_id: string;
  card_id: string;
  event_type: EventType;
  dwell_ms: number | null;
  estimated_read_ratio: number | null;
  position: number | null;
  signal_vector: SignalVector | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ─── ai_runs (§6) ──────────────────────────────────────────────────────────

export type RunType = 'cold_start_compose' | 'reflect' | 'compose' | 'strategic_reflect' | 'distill_quality';
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'conflict';

export interface AiRun {
  id: string;
  user_id: string;
  session_id: string | null;
  run_type: RunType;
  status: RunStatus;
  trigger_reason: string | null;
  input_snapshot: Record<string, unknown> | null;
  expected_versions: Record<string, number> | null;
  output: Record<string, unknown> | null;
  model: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  estimated_cost: number | null;
  attempts: number;
  next_retry_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ─── quality_recipes (§7) ───────────────────────────────────────────────────

export interface QualityRecipe {
  id: string;
  recipe: CardRecipe;
  diagnostic_purpose: string | null;
  text: string | null;
  language: string;
  source_card_id: string | null;
  source_run_id: string | null;
  privacy_state: 'clean' | 'needs_review' | 'personal';
  usage_count: number;
  strong_hit_count: number;
  weak_hit_count: number;
  prior_strength: number;
  created_at: string;
  updated_at: string;
}
