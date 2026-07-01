-- ============================================================================
-- Migration: 007_orchestrator_and_economics
-- Version: 1.0.0
-- Date: 2026-07-01
-- Source: docs/04_ORCHESTRATION.md (hard constraints), docs/05 (lifecycle),
--         docs/06 (trigger discipline / cost control)
-- Description:
--   1. New card status 'delivered' — honest impression tracking.
--      delivered = sent to client buffer; shown = client reported a real view.
--   2. Dedup of queued ai_runs — kills the "reflect/compose storm" that
--      multiplies OpenAI cost (the single biggest unit-economics leak).
--   3. Watchdog for stale 'running' runs — requeue triggers pg_net retry
--      via the existing on_ai_runs_queued trigger (003/004).
--   4. Tighten user INSERT policy on ai_runs (was: any run_type → bill abuse).
-- ============================================================================

-- ─── 1. Card lifecycle: candidate → queued → delivered → shown → hearted/discarded
ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_status_check;
ALTER TABLE cards ADD CONSTRAINT cards_status_check
  CHECK (status IN ('candidate', 'queued', 'delivered', 'shown', 'discarded', 'hearted'));

CREATE INDEX IF NOT EXISTS idx_cards_delivered
  ON cards(user_id, status) WHERE status = 'delivered';

-- ─── 2. AI-run dedup: at most ONE queued run per (user, run_type).
-- Insert of a duplicate fails with unique_violation → code treats it as
-- "already queued" (see _shared/orchestrator.ts queueAiRun).
-- Without this: every heart queues a reflect, every low-frontier check queues
-- a compose, 3 parallel prefetch calls queue 3 composes → 3-5x cost per session.
CREATE UNIQUE INDEX IF NOT EXISTS ai_runs_dedup_queued
  ON ai_runs(user_id, run_type) WHERE status = 'queued';

-- ─── 3. Watchdog: requeue stale running jobs (crash recovery).
-- Requeue flips status back to 'queued' which re-fires the pg_net trigger.
-- Runs with a queued sibling (dedup index) or exhausted attempts → failed.
CREATE OR REPLACE FUNCTION requeue_stale_ai_runs()
RETURNS void AS $$
BEGIN
  -- Exhausted or duplicated → failed
  UPDATE ai_runs r
  SET status = 'failed', completed_at = now()
  WHERE r.status = 'running'
    AND r.started_at < now() - interval '3 minutes'
    AND (
      r.attempts >= 3
      OR EXISTS (
        SELECT 1 FROM ai_runs q
        WHERE q.user_id = r.user_id
          AND q.run_type = r.run_type
          AND q.status = 'queued'
      )
    );

  -- Retryable → back to queue (fires ai-worker via on_ai_runs_queued)
  UPDATE ai_runs r
  SET status = 'queued'
  WHERE r.status = 'running'
    AND r.started_at < now() - interval '3 minutes'
    AND r.attempts < 3;
END;
$$ LANGUAGE plpgsql;

-- Schedule every minute if pg_cron is available (Supabase: enable in Dashboard
-- → Database → Extensions if this block raises a notice).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('requeue-stale-ai-runs', '* * * * *', 'SELECT requeue_stale_ai_runs()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable (%). Watchdog function created; schedule it manually or enable pg_cron.', SQLERRM;
END $$;

-- ─── 4. Tighten user-side ai_runs INSERT (was migration 005: any run_type).
-- Users may only queue their own cold_start_compose (onboarding pre-generation).
DROP POLICY IF EXISTS "Users can queue own ai_runs" ON ai_runs;
CREATE POLICY "Users can queue own cold start"
  ON ai_runs FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND run_type = 'cold_start_compose'
    AND status = 'queued'
  );
