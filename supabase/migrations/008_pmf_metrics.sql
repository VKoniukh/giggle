-- ============================================================================
-- Migration: 008_pmf_metrics
-- Date: 2026-07-05
-- Description: The PMF metric for this category is NOT retention or DAU.
--   A toy holds attention; a category accumulates identity. The category is
--   born (or not) at the moment of FIRST RECOGNITION — the first heart with
--   real read attention. This view measures Time-To-First-Recognition per
--   user: if the median user needs more than ~8 cards to feel "це буквально
--   я", the first session dies before the engine ever gets to show depth.
-- ============================================================================

CREATE OR REPLACE VIEW user_first_recognition AS
WITH impressions AS (
  SELECT user_id, card_id, created_at,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS impression_n
  FROM events
  WHERE event_type = 'impression'
),
first_heart AS (
  SELECT DISTINCT ON (e.user_id)
         e.user_id,
         e.card_id,
         e.created_at AS first_heart_at,
         e.estimated_read_ratio
  FROM events e
  WHERE e.event_type = 'heart'
  ORDER BY e.user_id, e.created_at
),
first_session AS (
  SELECT DISTINCT ON (user_id) user_id, id AS session_id, started_at
  FROM sessions
  ORDER BY user_id, started_at
)
SELECT
  fs.user_id,
  fs.started_at                                   AS first_session_at,
  fh.first_heart_at,

  -- Cards seen before the first recognition (the category-birth number)
  (SELECT i.impression_n FROM impressions i
   WHERE i.user_id = fs.user_id AND i.card_id = fh.card_id
  )                                               AS cards_to_first_heart,

  ROUND(EXTRACT(EPOCH FROM (fh.first_heart_at - fs.started_at)) / 60.0, 1)
                                                  AS minutes_to_first_heart,

  fh.estimated_read_ratio                         AS first_heart_read_ratio,

  -- Did the user come back after the day of the first session?
  EXISTS (
    SELECT 1 FROM sessions s2
    WHERE s2.user_id = fs.user_id
      AND s2.started_at > fs.started_at + interval '12 hours'
  )                                               AS returned_after_first_day

FROM first_session fs
LEFT JOIN first_heart fh ON fh.user_id = fs.user_id;

-- Cohort read: SELECT
--   percentile_cont(0.5) WITHIN GROUP (ORDER BY cards_to_first_heart) AS median_ttfr,
--   AVG(CASE WHEN returned_after_first_day THEN 1 ELSE 0 END)         AS d1_return
-- FROM user_first_recognition;
-- Target: median TTFR ≤ 8 cards. Users with TTFR ≤ 8 should return
-- dramatically more often than TTFR > 8 — if they don't, recognition is
-- not the driver and the category thesis needs revision.
