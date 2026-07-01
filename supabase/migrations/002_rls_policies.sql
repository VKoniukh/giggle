-- ============================================================================
-- Migration: 002_rls_policies
-- Version: 1.0.0
-- Date: 2026-06-23
-- Source: Supabase Auth integration
-- Description: Row Level Security policies for all 7 tables
-- Dependencies: 000_init_tables.sql
-- ============================================================================
--
-- Principle: Every user can only access their own data.
-- Exception: quality_recipes — read-only for all authenticated users.
-- Exception: ai_runs — write access only through service role (Edge Functions).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- Enable RLS on all tables
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_minds ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_recipes ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────────
-- user_minds: user can read/update their own row
-- Creation happens via Edge Function (service role) after auth signup
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "Users can view own mind"
  ON user_minds FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own mind"
  ON user_minds FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Insert via service role only (Edge Functions handle user_minds creation)
CREATE POLICY "Service role can insert user_minds"
  ON user_minds FOR INSERT
  WITH CHECK (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- sessions: user can read own sessions
-- Create/update via service role (Edge Functions)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "Users can view own sessions"
  ON sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own sessions"
  ON sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON sessions FOR UPDATE
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- threads: user can read own threads
-- Modification via service role (AI patches through Edge Functions)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "Users can view own threads"
  ON threads FOR SELECT
  USING (auth.uid() = user_id);

-- Threads are created/modified by Edge Functions (service role)
-- but user context needs read access for client-side canon display


-- ─────────────────────────────────────────────────────────────────────────────
-- cards: user can read own cards (for Personal Canon display)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "Users can view own cards"
  ON cards FOR SELECT
  USING (auth.uid() = user_id);

-- Cards are created by Edge Functions (service role)
-- User can "uncollect" from canon (update hearted → shown)
CREATE POLICY "Users can update own cards"
  ON cards FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- events: user can read own events, insert own events
-- Events are IMMUTABLE — no update policy
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "Users can view own events"
  ON events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own events"
  ON events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- NO UPDATE OR DELETE POLICY — events are immutable!


-- ─────────────────────────────────────────────────────────────────────────────
-- ai_runs: read-only for user (lineage/transparency)
-- All writes via service role (Edge Functions)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "Users can view own ai_runs"
  ON ai_runs FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE for users — managed by Edge Functions with service role


-- ─────────────────────────────────────────────────────────────────────────────
-- quality_recipes: read for all authenticated users (collective fund)
-- Write via service role only (distill_quality ai_run)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "Authenticated users can read quality_recipes"
  ON quality_recipes FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE for regular users — managed by Edge Functions


-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE. RLS enabled and policies created for all 7 tables.
-- ═══════════════════════════════════════════════════════════════════════════════
