-- The old post-status trigger is no longer needed.
-- Feed visibility is now determined entirely by the presence of
-- at least one telegram_post_media row with cache_status = 'ready'.

DROP TRIGGER IF EXISTS trg_post_status_from_media_cache ON telegram_post_media;
DROP FUNCTION IF EXISTS sync_post_status_from_media_cache();
