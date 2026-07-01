-- ============================================================================
-- Migration: 004_fix_ai_worker_trigger_key
-- Description: Fixes the AI worker trigger to use the actual anon key
--              instead of relying on app.settings.anon_key which may not be set.
-- ============================================================================

-- Recreate the trigger function with hardcoded anon key
CREATE OR REPLACE FUNCTION trigger_ai_worker()
RETURNS trigger AS $$
BEGIN
  -- Trigger the edge function asynchronously (fire-and-forget)
  PERFORM net.http_post(
    url := 'https://gcnhqcwvnxpckscvzvnr.supabase.co/functions/v1/ai-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjbmhxY3d2bnhwY2tzY3Z6dm5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNDI1MzIsImV4cCI6MjA5NzgxODUzMn0.V3hmre6uJu4_19bsUheL14mB1zVWF3Cl32yl7FVZRaY'
    ),
    body := json_build_object('run_id', NEW.id)::jsonb
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists from 003, but recreate to be safe
DROP TRIGGER IF EXISTS on_ai_runs_queued ON ai_runs;
CREATE TRIGGER on_ai_runs_queued
  AFTER INSERT OR UPDATE OF status ON ai_runs
  FOR EACH ROW
  WHEN (NEW.status = 'queued')
  EXECUTE FUNCTION trigger_ai_worker();
