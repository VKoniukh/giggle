-- ============================================================================
-- Migration 006: AI Token Analytics Views  
-- 
-- PRACTICAL views for cost analysis:
-- - Per user × per model × per run_type token breakdown
-- - Per card generation cost (the REAL unit economics metric)
-- - Per session cost breakdown
-- ============================================================================

-- ─── View 1: User × Model × RunType Token Breakdown ────────────────────────
-- THE view you need: how many tokens each user consumed, by which model,
-- for which mechanism. This tells you the REAL cost structure.
CREATE OR REPLACE VIEW v_user_token_breakdown AS
SELECT
  r.user_id,
  r.model,
  r.run_type,
  COUNT(*) AS runs,
  SUM(r.input_tokens) AS input_tokens,
  SUM(r.output_tokens) AS output_tokens,
  SUM(r.cached_tokens) AS cached_tokens,
  SUM(r.estimated_cost)::numeric(10,6) AS cost,
  AVG(r.input_tokens)::int AS avg_input_tokens,
  AVG(r.output_tokens)::int AS avg_output_tokens,
  -- How many cards this actually produced
  COUNT(DISTINCT c.id) AS cards_generated,
  -- Cost per card (the metric that matters)
  CASE 
    WHEN COUNT(DISTINCT c.id) > 0 
    THEN (SUM(r.estimated_cost) / COUNT(DISTINCT c.id))::numeric(10,6)
    ELSE NULL
  END AS cost_per_card
FROM ai_runs r
LEFT JOIN cards c ON c.generated_by_run_id = r.id
WHERE r.status = 'completed'
GROUP BY r.user_id, r.model, r.run_type
ORDER BY r.user_id, cost DESC;

-- ─── View 2: Per-card cost with full context ────────────────────────────────
-- Shows what each card ACTUALLY cost to generate, including the model,
-- run_type, language, and how many siblings it had in that batch
CREATE OR REPLACE VIEW v_card_cost AS
SELECT
  c.id AS card_id,
  c.user_id,
  c.language,
  c.move,
  c.format,
  c.status AS card_status,
  r.run_type,
  r.model,
  r.input_tokens AS run_input_tokens,
  r.output_tokens AS run_output_tokens,
  r.cached_tokens AS run_cached_tokens,
  r.estimated_cost AS run_total_cost,
  -- Number of cards in this batch
  batch.batch_size,
  -- Per-card cost = run cost / batch size
  (r.estimated_cost / GREATEST(batch.batch_size, 1))::numeric(10,6) AS per_card_cost,
  c.created_at
FROM cards c
JOIN ai_runs r ON c.generated_by_run_id = r.id
JOIN LATERAL (
  SELECT COUNT(*)::int AS batch_size
  FROM cards c2
  WHERE c2.generated_by_run_id = r.id
) batch ON true
WHERE r.status = 'completed';

-- ─── View 3: Session cost breakdown ─────────────────────────────────────────
-- How much each session cost, broken down by mechanism
CREATE OR REPLACE VIEW v_session_costs AS
SELECT
  r.session_id,
  r.user_id,
  s.started_at AS session_started,
  s.cards_shown,
  s.strong_signals,
  -- Total tokens & cost for this session
  SUM(r.input_tokens) AS total_input_tokens,
  SUM(r.output_tokens) AS total_output_tokens,
  SUM(r.estimated_cost)::numeric(10,6) AS total_cost,
  -- Breakdown by mechanism
  SUM(r.estimated_cost) FILTER (WHERE r.run_type IN ('compose', 'cold_start_compose'))::numeric(10,6) AS compose_cost,
  SUM(r.estimated_cost) FILTER (WHERE r.run_type = 'reflect')::numeric(10,6) AS reflect_cost,
  SUM(r.estimated_cost) FILTER (WHERE r.run_type = 'strategic_reflect')::numeric(10,6) AS strategic_cost,
  -- Cards generated in this session
  COUNT(DISTINCT c.id) AS cards_generated,
  -- Cost per card shown
  CASE 
    WHEN s.cards_shown > 0 
    THEN (SUM(r.estimated_cost) / s.cards_shown)::numeric(10,6)
    ELSE NULL
  END AS cost_per_card_shown,
  -- Models used
  array_agg(DISTINCT r.model) AS models_used
FROM ai_runs r
JOIN sessions s ON r.session_id = s.id
LEFT JOIN cards c ON c.generated_by_run_id = r.id
WHERE r.status = 'completed'
GROUP BY r.session_id, r.user_id, s.started_at, s.cards_shown, s.strong_signals;

-- ─── View 4: Quick daily summary ────────────────────────────────────────────
CREATE OR REPLACE VIEW v_daily_costs AS
SELECT
  DATE(r.created_at) AS day,
  COUNT(DISTINCT r.user_id) AS users,
  SUM(r.input_tokens) AS input_tokens,
  SUM(r.output_tokens) AS output_tokens,
  SUM(r.estimated_cost)::numeric(10,4) AS cost,
  COUNT(DISTINCT c.id) AS cards_made,
  CASE 
    WHEN COUNT(DISTINCT c.id) > 0 
    THEN (SUM(r.estimated_cost) / COUNT(DISTINCT c.id))::numeric(10,6)
    ELSE NULL
  END AS cost_per_card,
  -- Model distribution
  COUNT(*) FILTER (WHERE r.model LIKE '%mini%') AS mini_runs,
  COUNT(*) FILTER (WHERE r.model NOT LIKE '%mini%') AS full_runs
FROM ai_runs r
LEFT JOIN cards c ON c.generated_by_run_id = r.id
WHERE r.status = 'completed'
GROUP BY DATE(r.created_at)
ORDER BY day DESC;
