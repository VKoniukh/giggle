-- ============================================================================
-- Migration: 003_ai_worker_trigger
-- Description: Automates the background execution of the AI Worker edge function
--              using Supabase Webhooks (pg_net) without relying on pg_cron.
--              Implements "Event-Driven Lazy Evaluation" from docs/04_ORCHESTRATION.md
-- ============================================================================

-- Enable pg_net for async HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Function to trigger AI Worker
CREATE OR REPLACE FUNCTION trigger_ai_worker()
RETURNS trigger AS $$
DECLARE
  -- Dynamically get the project reference URL and anon key from Supabase settings
  -- If unavailable, replace with hardcoded URL: https://gcnhqcwvnxpckscvzvnr.supabase.co/functions/v1/ai-worker
  webhook_url text := 'https://gcnhqcwvnxpckscvzvnr.supabase.co/functions/v1/ai-worker';
  anon_key text := current_setting('app.settings.anon_key', true);
BEGIN
  -- Trigger the edge function asynchronously (fire-and-forget)
  PERFORM net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(anon_key, 'YOUR_ANON_KEY')
    ),
    body := json_build_object('run_id', NEW.id)::jsonb
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger on the ai_runs table
DROP TRIGGER IF EXISTS on_ai_runs_queued ON ai_runs;
CREATE TRIGGER on_ai_runs_queued
  AFTER INSERT OR UPDATE OF status ON ai_runs
  FOR EACH ROW
  WHEN (NEW.status = 'queued')
  EXECUTE FUNCTION trigger_ai_worker();
