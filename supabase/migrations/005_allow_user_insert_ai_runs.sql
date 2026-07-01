-- ============================================================================
-- Migration: 005_allow_user_insert_ai_runs
-- Description: Allow authenticated users to insert their own ai_runs.
--              Needed for pre-generation: language.tsx inserts a 
--              cold_start_compose run during onboarding step 1, so probes
--              are generated while user completes steps 2-3.
-- ============================================================================

CREATE POLICY "Users can queue own ai_runs"
  ON ai_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);
