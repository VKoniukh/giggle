-- ============================================================================
-- Migration: 000_init_tables
-- Version: 1.0.0
-- Date: 2026-06-23
-- Source: docs/05_DATA_ARCHITECTURE.md
-- Description: Creates all 7 core tables for Giggle — Personal Resonance Engine
-- ============================================================================
-- 
-- Tables created:
--   1. user_minds    — strategic user state (compressed map for retrieval)
--   2. sessions      — session rhythm tracking
--   3. threads       — live semantic threads (heart of memory)
--   4. cards         — materialized textual experiments
--   5. events        — immutable reaction journal
--   6. ai_runs       — AI lineage, audit, durable queue
--   7. quality_recipes — collective quality fund
--
-- Dependencies: auth.users (Supabase Auth, already exists)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: auto-update updated_at timestamp
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. user_minds — Strategic State
-- Source: docs/05_DATA_ARCHITECTURE.md §1
-- 
-- Compact view per user. Not full memory — compressed map for retrieval.
-- JSONB contracts:
--   onboarding_context: { familiar_worlds[], language, life_context_hints[] }
--   boundaries: { allowed[], restricted[], forbidden[] }
--   language_state: { primary, cultural_context, preferred_register }
--   known_anti_patterns: string[]
--   unexplored_frontiers: string[]
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE user_minds (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Onboarding & boundaries
  onboarding_context   jsonb NOT NULL DEFAULT '{}',
  boundaries           jsonb NOT NULL DEFAULT '{}',
  language_state       jsonb NOT NULL DEFAULT '{}',

  -- Strategic memory (AI-authored)
  strategic_summary    text,
  known_anti_patterns  jsonb NOT NULL DEFAULT '[]',
  unexplored_frontiers jsonb NOT NULL DEFAULT '[]',

  -- Onboarding completion
  onboarding_completed boolean NOT NULL DEFAULT false,

  -- Versioning
  profile_version      bigint NOT NULL DEFAULT 1,
  last_reflection_at           timestamptz,
  last_strategic_reflection_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER user_minds_updated_at
  BEFORE UPDATE ON user_minds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. sessions — Session Rhythm
-- Source: docs/05_DATA_ARCHITECTURE.md §2
--
-- Each session is a separate entity because it carries DRAMATURGY.
-- JSONB contract for rhythm_state:
--   { recent_moves[], recent_thread_ids[], current_temperature,
--     novelty_debt, risk_budget, intensity,
--     formats_recently_used[], threads_to_rest[] }
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES user_minds(user_id) ON DELETE CASCADE,

  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'ended')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,

  -- Rhythm tracking
  rhythm_state    jsonb NOT NULL DEFAULT '{}',
  cards_shown     int NOT NULL DEFAULT 0,
  strong_signals  int NOT NULL DEFAULT 0,
  cards_since_reflection int NOT NULL DEFAULT 0,

  session_version bigint NOT NULL DEFAULT 1
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_status ON sessions(user_id, status);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. threads — Heart of Memory
-- Source: docs/05_DATA_ARCHITECTURE.md §3
--
-- Live semantic threads. Each is a WORKING HYPOTHESIS, not truth.
-- Status lifecycle: candidate → active → resting → dormant → retired
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE threads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES user_minds(user_id) ON DELETE CASCADE,

  -- Semantic content (AI-authored, natural language)
  core               text NOT NULL,
  mechanism          text NOT NULL,
  emotional_payoffs  jsonb NOT NULL DEFAULT '[]',
  working_voices     jsonb NOT NULL DEFAULT '[]',
  confirmed_contexts jsonb NOT NULL DEFAULT '[]',
  contexts_to_try    jsonb NOT NULL DEFAULT '[]',
  avoid              jsonb NOT NULL DEFAULT '[]',
  open_question      text,

  -- Epistemic state
  confidence         numeric NOT NULL DEFAULT 0.3
                       CHECK (confidence >= 0 AND confidence <= 1),
  heat               numeric NOT NULL DEFAULT 0.5
                       CHECK (heat >= 0 AND heat <= 1),
  fatigue            numeric NOT NULL DEFAULT 0.0
                       CHECK (fatigue >= 0 AND fatigue <= 1),
  depth              int NOT NULL DEFAULT 1
                       CHECK (depth >= 1),

  -- Evidence (card IDs as JSON arrays)
  positive_evidence  jsonb NOT NULL DEFAULT '[]',
  counter_evidence   jsonb NOT NULL DEFAULT '[]',

  -- Lifecycle
  status             text NOT NULL DEFAULT 'candidate'
                       CHECK (status IN ('candidate', 'active', 'resting', 'dormant', 'retired')),
  version            bigint NOT NULL DEFAULT 1,
  last_used_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_threads_user_id ON threads(user_id);
CREATE INDEX idx_threads_user_status ON threads(user_id, status);

CREATE TRIGGER threads_updated_at
  BEFORE UPDATE ON threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. cards — Materialized Experiments
-- Source: docs/05_DATA_ARCHITECTURE.md §4
--
-- Not just texts — each card knows WHAT HYPOTHESIS it tests and
-- WHAT different reactions will mean.
-- 
-- move enum: probe, deepen, mutate, transfer, bridge, contrast, callback, wildcard, rest_card
-- status lifecycle: candidate → queued → shown → (discarded | hearted)
-- scope: personal, reusable_exact, reusable_recipe, global_probe
-- ═══════════════════════════════════════════════════════════════════════════════

-- Forward declaration needed: ai_runs referenced by cards, but ai_runs references cards too
-- Solution: create ai_runs first without card FK, then create cards, then add FK

CREATE TABLE ai_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES user_minds(user_id) ON DELETE CASCADE,
  session_id         uuid REFERENCES sessions(id) ON DELETE SET NULL,

  run_type           text NOT NULL
                       CHECK (run_type IN ('cold_start_compose', 'reflect', 'compose', 'strategic_reflect', 'distill_quality')),
  status             text NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'running', 'completed', 'failed', 'conflict')),
  trigger_reason     text,

  -- Snapshot of input state at time of creation
  input_snapshot     jsonb,
  expected_versions  jsonb,
  output             jsonb,

  -- Model & prompt tracking
  model              text,
  prompt_version     text,
  schema_version     text,

  -- Token accounting (from OpenAI usage response)
  input_tokens       int,
  output_tokens      int,
  cached_tokens      int,
  estimated_cost     numeric,

  -- Retry logic
  attempts           int NOT NULL DEFAULT 0,
  next_retry_at      timestamptz,

  -- Timestamps
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_runs_user_id ON ai_runs(user_id);
CREATE INDEX idx_ai_runs_status ON ai_runs(status);
CREATE INDEX idx_ai_runs_queued ON ai_runs(status, created_at) WHERE status = 'queued';


CREATE TABLE cards (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid REFERENCES user_minds(user_id) ON DELETE CASCADE,
  session_id             uuid REFERENCES sessions(id) ON DELETE SET NULL,

  -- Content
  text                   text NOT NULL,
  language               text NOT NULL DEFAULT 'uk',
  format                 text,
  move                   text NOT NULL
                           CHECK (move IN ('probe', 'deepen', 'mutate', 'transfer', 'bridge', 'contrast', 'callback', 'wildcard', 'rest_card')),

  -- Semantic experiment
  recipe                 jsonb NOT NULL DEFAULT '{}',
  hypothesis_tested      text,
  expected_learning      jsonb,

  -- Lineage
  source_thread_ids      uuid[],
  source_thread_versions jsonb,
  parent_card_ids        uuid[],
  generated_by_run_id    uuid REFERENCES ai_runs(id) ON DELETE SET NULL,

  -- Lifecycle
  status                 text NOT NULL DEFAULT 'candidate'
                           CHECK (status IN ('candidate', 'queued', 'shown', 'discarded', 'hearted')),
  queue_priority         numeric NOT NULL DEFAULT 0.5,
  scope                  text NOT NULL DEFAULT 'personal'
                           CHECK (scope IN ('personal', 'reusable_exact', 'reusable_recipe', 'global_probe')),
  quality_state          text,

  shown_at               timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cards_user_id ON cards(user_id);
CREATE INDEX idx_cards_user_status ON cards(user_id, status);
CREATE INDEX idx_cards_session ON cards(session_id);
CREATE INDEX idx_cards_queued ON cards(user_id, status, queue_priority DESC) WHERE status = 'queued';


-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. events — Immutable Reality Journal
-- Source: docs/05_DATA_ARCHITECTURE.md §5
--
-- EVENTS ARE NEVER EDITED BY AI.
-- This is the factual layer from which all interpretations can be rebuilt
-- when prompts or models change.
--
-- event_type enum: impression, stop, skip, heart, share, back
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES user_minds(user_id) ON DELETE CASCADE,
  session_id          uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  card_id             uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,

  event_type          text NOT NULL
                        CHECK (event_type IN ('impression', 'stop', 'skip', 'heart', 'share', 'back')),

  -- Implicit signal data
  dwell_ms            int,
  estimated_read_ratio numeric,
  position            int,

  -- Computed signal vector
  signal_vector       jsonb,
  metadata            jsonb,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_events_card ON events(card_id);
CREATE INDEX idx_events_type ON events(user_id, event_type);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. quality_recipes — Collective Quality Fund
-- Source: docs/05_DATA_ARCHITECTURE.md §7
--
-- Separated from personal cards. Contains:
-- - reusable recipes (mechanism without personal context)
-- - diagnostic cards (for cold start differentiation)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE quality_recipes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  recipe              jsonb NOT NULL,
  diagnostic_purpose  text,

  -- Optional exact text for reusable cards
  text                text,
  language            text NOT NULL DEFAULT 'uk',

  source_card_id      uuid REFERENCES cards(id) ON DELETE SET NULL,
  source_run_id       uuid REFERENCES ai_runs(id) ON DELETE SET NULL,

  privacy_state       text NOT NULL DEFAULT 'clean'
                        CHECK (privacy_state IN ('clean', 'needs_review', 'personal')),

  usage_count         int NOT NULL DEFAULT 0,
  strong_hit_count    int NOT NULL DEFAULT 0,
  weak_hit_count      int NOT NULL DEFAULT 0,

  prior_strength      numeric NOT NULL DEFAULT 0.5,
  -- semantic_embedding  vector,  -- pgvector, enable later

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_quality_recipes_language ON quality_recipes(language);
CREATE INDEX idx_quality_recipes_strength ON quality_recipes(prior_strength DESC);

CREATE TRIGGER quality_recipes_updated_at
  BEFORE UPDATE ON quality_recipes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE. All 7 tables created.
-- Next: 001_views.sql (analytics views)
-- ═══════════════════════════════════════════════════════════════════════════════
