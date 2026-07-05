-- ============================================================================
-- Migration: 009_validation_dashboard
-- Date: 2026-07-05
-- Description: Objective validation of the engine — three views, no new
--   tables, no product complexity. Answers three questions the founder
--   cannot answer by scrolling:
--   1. model_economics      — tokens & cost PER MODEL per operation (not one
--                             abstract counter): what does each model cost us
--                             and what does it produce?
--   2. user_mind_growth     — does the semantic base per user actually GROW
--                             (threads, depth, canon, contributed recipes)?
--   3. user_weekly_resonance — THE core promise of the algorithm, measured:
--                             "потрапляння стають частіші". If per-user
--                             weekly resonance does not trend upward, the
--                             learning loop is not learning — regardless of
--                             how clever the architecture is.
-- ============================================================================

-- ─── 1. Per-model economics & output quality ────────────────────────────────
-- ai_runs.model is recorded per run, so switching models via env vars
-- (GIGGLE_MODEL_COMPOSE / _REFLECT / _STRATEGIC) automatically splits here.
-- validation counters (language/compression violations) ride in output JSON.
CREATE OR REPLACE VIEW model_economics AS
SELECT
  model,
  run_type,
  prompt_version,
  date_trunc('day', completed_at)::date         AS day,
  COUNT(*)                                       AS runs,
  SUM(input_tokens)                              AS input_tokens,
  SUM(cached_tokens)                             AS cached_tokens,
  SUM(output_tokens)                             AS output_tokens,
  ROUND(SUM(estimated_cost)::numeric, 4)         AS cost_usd,
  SUM((output->'validation'->>'accepted')::int)             AS cards_accepted,
  SUM((output->'validation'->>'language_violations')::int)  AS language_violations,
  SUM((output->'validation'->>'compression_violations')::int) AS compression_violations,
  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::numeric, 1) AS avg_seconds
FROM ai_runs
WHERE status = 'completed' AND model IS NOT NULL
GROUP BY model, run_type, prompt_version, date_trunc('day', completed_at)
ORDER BY day DESC, model, run_type;

-- ─── 2. Growth of the semantic base per user ────────────────────────────────
CREATE OR REPLACE VIEW user_mind_growth AS
SELECT
  um.user_id,
  um.created_at::date AS user_since,
  (SELECT COUNT(*) FROM threads t WHERE t.user_id = um.user_id)                                    AS threads_total,
  (SELECT COUNT(*) FROM threads t WHERE t.user_id = um.user_id AND t.status = 'active')            AS threads_active,
  (SELECT COUNT(*) FROM threads t WHERE t.user_id = um.user_id AND t.status IN ('resting','dormant')) AS threads_breathing,
  (SELECT COUNT(*) FROM threads t WHERE t.user_id = um.user_id AND t.status = 'retired')           AS threads_retired,
  (SELECT MAX(t.depth) FROM threads t WHERE t.user_id = um.user_id)                                AS max_depth,
  (SELECT ROUND(AVG(t.depth), 1) FROM threads t WHERE t.user_id = um.user_id AND t.status = 'active') AS avg_active_depth,
  (SELECT COUNT(*) FROM cards c WHERE c.user_id = um.user_id AND c.status = 'hearted')             AS canon_size,
  (SELECT COUNT(*) FROM cards c WHERE c.user_id = um.user_id AND c.status IN ('shown','hearted'))  AS cards_seen,
  (SELECT COUNT(*) FROM quality_recipes qr JOIN cards c ON c.id = qr.source_card_id
    WHERE c.user_id = um.user_id)                                                                  AS recipes_contributed,
  (SELECT COUNT(DISTINCT date_trunc('day', s.started_at)) FROM sessions s
    WHERE s.user_id = um.user_id)                                                                  AS active_days,
  (um.strategic_summary IS NOT NULL)                                                               AS has_strategic_summary
FROM user_minds um;

-- ─── 3. The algorithm's core promise, as a number ────────────────────────────
-- Healthy engine: weekly_resonance RISES week over week for a returning user.
-- Flat = the loop records but does not learn. Falling = burnout / repetition.
CREATE OR REPLACE VIEW user_weekly_resonance AS
SELECT
  user_id,
  date_trunc('week', created_at)::date AS week,
  COUNT(*) FILTER (WHERE event_type = 'impression')  AS cards_seen,
  COUNT(*) FILTER (WHERE event_type = 'heart')       AS hearts,
  COUNT(*) FILTER (WHERE event_type = 'share')       AS shares,
  ROUND(
    COUNT(*) FILTER (WHERE event_type = 'heart')::numeric
    / NULLIF(COUNT(*) FILTER (WHERE event_type = 'impression'), 0), 3
  ) AS weekly_resonance
FROM events
GROUP BY user_id, date_trunc('week', created_at)
ORDER BY user_id, week;
