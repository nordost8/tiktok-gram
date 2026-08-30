-- Store photo media bytes in Postgres (not R2). Video/animation stay in R2.
-- Cap: PHOTO_POST_LIMIT env (default 5000 photo-only posts with cached bytes).
--
-- Run once: psql "$POSTGRES_URL" -f packages/db/scripts/migrate-photo-pg-storage.sql

BEGIN;

ALTER TABLE telegram_post_media
  ADD COLUMN IF NOT EXISTS cached_data bytea,
  ADD COLUMN IF NOT EXISTS storage_backend varchar(16) NOT NULL DEFAULT 'r2';

CREATE INDEX IF NOT EXISTS telegram_post_media_storage_backend_idx
  ON telegram_post_media (storage_backend)
  WHERE storage_backend = 'postgres';

COMMIT;
