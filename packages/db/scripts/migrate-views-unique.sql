-- Make telegram_user_post_views (profile_id, post_id) unique.
-- Removes duplicate view rows (keeps the one with the best signal: highest
-- completed_percent, then highest duration_ms, then latest viewed_at) and
-- replaces the non-unique index with a UNIQUE one so the API can use
-- INSERT ... ON CONFLICT DO UPDATE.
--
-- Run once: psql "$POSTGRES_URL" -f packages/db/scripts/migrate-views-unique.sql

BEGIN;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY profile_id, post_id
      ORDER BY
        COALESCE(completed_percent, 0) DESC,
        COALESCE(duration_ms, 0) DESC,
        viewed_at DESC,
        id DESC
    ) AS rn
  FROM telegram_user_post_views
)
DELETE FROM telegram_user_post_views v
USING ranked r
WHERE v.id = r.id
  AND r.rn > 1;

DROP INDEX IF EXISTS telegram_user_post_views_profile_post_idx;

CREATE UNIQUE INDEX telegram_user_post_views_profile_post_idx
  ON telegram_user_post_views (profile_id, post_id);

COMMIT;
