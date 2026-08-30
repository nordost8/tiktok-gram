-- Post `ready` = playable in feed (primary media in MinIO).
-- Run once: psql "$POSTGRES_URL" -f packages/db/scripts/migrate-post-awaiting-cache.sql

ALTER TYPE telegram_post_status ADD VALUE IF NOT EXISTS 'awaiting_cache';

UPDATE telegram_posts p
SET status = 'awaiting_cache'
FROM telegram_post_media m
WHERE p.primary_media_id = m.id
  AND p.status = 'ready'
  AND (
    m.cache_status IS DISTINCT FROM 'ready'
    OR m.cache_range_ready IS NOT TRUE
  );

UPDATE telegram_posts p
SET status = 'ready'
FROM telegram_post_media m
WHERE p.primary_media_id = m.id
  AND p.status IN ('processing', 'awaiting_cache')
  AND m.cache_status = 'ready'
  AND m.cache_range_ready = TRUE;
