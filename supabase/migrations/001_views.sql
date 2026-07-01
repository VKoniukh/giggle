-- ============================================================================
-- Migration: 001_views
-- Version: 1.0.0
-- Date: 2026-06-23
-- Source: docs/04_ORCHESTRATION.md §System Quality Dashboard
--         docs/05_DATA_ARCHITECTURE.md §Token Economics
-- Description: Analytics views for algorithm health and cost tracking
-- Dependencies: 000_init_tables.sql
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEW 1: user_algorithm_health
-- Source: docs/04_ORCHESTRATION.md §System Quality Dashboard
--
-- 5 numbers that show everything about algorithm quality for a specific user:
-- 1. Resonance Rate       — share of cards with strong signal
-- 2. Transfer Success     — does AI actually understand deep mechanism
-- 3. Thread Diversity     — is system stuck on one thread
-- 4. Breathing Index      — do threads rest
-- 5. Avg Depth            — do threads deepen over time
--
-- Alert thresholds:
-- resonance_rate < 0.15 after 50 cards → AI generates weak content
-- transfer_success = 0 after 30 cards → AI makes fake transfers
-- thread_diversity < 2 in 20 cards → orchestrator stuck
-- breathing_index = 0 after 3 sessions → fatigue logic broken
-- depth not growing after 5 sessions → system stuck on surface
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW user_algorithm_health AS
SELECT
  um.user_id,

  -- 1. Resonance Rate: hearts+shares / total shown cards
  ROUND(
    COUNT(e.id) FILTER (WHERE e.event_type IN ('heart', 'share'))::numeric
    / NULLIF(
        (SELECT COUNT(*) FROM cards c2
         WHERE c2.user_id = um.user_id
           AND c2.status IN ('shown', 'hearted')), 0
      ), 3
  ) AS resonance_rate,

  -- 2. Transfer Success Rate: hearts on transfer/bridge cards / total transfer/bridge shown
  ROUND(
    (SELECT COUNT(*) FROM events e2
       JOIN cards c3 ON c3.id = e2.card_id
     WHERE e2.user_id = um.user_id
       AND e2.event_type = 'heart'
       AND c3.move IN ('transfer', 'bridge'))::numeric
    / NULLIF(
        (SELECT COUNT(*) FROM cards c4
         WHERE c4.user_id = um.user_id
           AND c4.move IN ('transfer', 'bridge')
           AND c4.status IN ('shown', 'hearted')), 0
      ), 3
  ) AS transfer_success_rate,

  -- 3. Thread Diversity: distinct threads in last 20 shown cards
  (SELECT COUNT(DISTINCT unnested_tid)
   FROM (
     SELECT unnest(c5.source_thread_ids) AS unnested_tid
     FROM cards c5
     WHERE c5.user_id = um.user_id
       AND c5.status IN ('shown', 'hearted')
     ORDER BY c5.shown_at DESC
     LIMIT 20
   ) AS recent_threads
  ) AS recent_thread_diversity,

  -- 4. Breathing Index: resting+dormant / active+resting threads
  ROUND(
    COUNT(t.id) FILTER (WHERE t.status IN ('resting', 'dormant'))::numeric
    / NULLIF(COUNT(t.id) FILTER (WHERE t.status IN ('active', 'resting')), 0), 3
  ) AS breathing_index,

  -- 5. Avg active thread depth
  ROUND(AVG(t.depth) FILTER (WHERE t.status = 'active'), 1) AS avg_active_depth,

  -- Bonus: total cards shown for context
  (SELECT COUNT(*) FROM cards c6
   WHERE c6.user_id = um.user_id
     AND c6.status IN ('shown', 'hearted')
  ) AS total_cards_shown

FROM user_minds um
LEFT JOIN threads t ON t.user_id = um.user_id
LEFT JOIN events e ON e.user_id = um.user_id
GROUP BY um.user_id;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEW 2: cost_breakdown_by_operation
-- Source: docs/05_DATA_ARCHITECTURE.md §Token Economics
--
-- One query shows how much each AI operation type costs per user per day.
-- If reflect consumes 60% of budget → reflection is too frequent or prompt
-- is overcomplicated.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW cost_breakdown_by_operation AS
SELECT
  user_id,
  run_type,
  date_trunc('day', completed_at) AS usage_date,
  COUNT(*)                        AS operations,
  SUM(input_tokens)               AS total_input_tokens,
  SUM(output_tokens)              AS total_output_tokens,
  SUM(cached_tokens)              AS total_cached_tokens,
  SUM(estimated_cost)             AS cost_usd
FROM ai_runs
WHERE status = 'completed'
GROUP BY user_id, run_type, date_trunc('day', completed_at);


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEW 3: user_unit_economics
-- Source: docs/05_DATA_ARCHITECTURE.md §Token Economics
--
-- The fundamental unit: Cost per Card Shown.
-- From this, all economics emerge:
--   cost_per_card_shown × avg_cards_per_session × sessions_per_day × 30 = MAU cost
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW user_unit_economics AS
SELECT
  ar.user_id,
  COUNT(DISTINCT ar.id)                          AS total_ai_calls,
  SUM(ar.estimated_cost)                         AS total_cost_usd,
  
  (SELECT COUNT(*)
   FROM cards c
   WHERE c.user_id = ar.user_id
     AND c.status IN ('shown', 'hearted')
  )                                               AS cards_shown,
  
  ROUND(
    SUM(ar.estimated_cost)
    / NULLIF(
        (SELECT COUNT(*)
         FROM cards c2
         WHERE c2.user_id = ar.user_id
           AND c2.status IN ('shown', 'hearted')), 0
      ), 6
  )                                               AS cost_per_card_shown,
  
  COUNT(DISTINCT s.id)                            AS total_sessions,
  
  ROUND(
    SUM(ar.estimated_cost)
    / NULLIF(COUNT(DISTINCT s.id), 0), 4
  )                                               AS cost_per_session,
  
  ROUND(
    SUM(ar.estimated_cost)
    / NULLIF(COUNT(DISTINCT date_trunc('day', s.started_at)), 0), 4
  )                                               AS cost_per_active_day

FROM ai_runs ar
LEFT JOIN sessions s ON s.user_id = ar.user_id
WHERE ar.status = 'completed'
GROUP BY ar.user_id;


-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE. All 3 views created.
-- Next: 002_rls_policies.sql (Row Level Security)
-- ═══════════════════════════════════════════════════════════════════════════════
