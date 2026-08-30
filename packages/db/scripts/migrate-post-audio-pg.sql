-- Add audio_data bytea column so TikTok music mp3 bytes are stored in Postgres
-- (mirrors the photo-in-Postgres pattern). R2 holds video only. Additive & idempotent.
--
-- Run: psql "$POSTGRES_URL" -f packages/db/scripts/migrate-post-audio-pg.sql

ALTER TABLE telegram_post_descriptions ADD COLUMN IF NOT EXISTS audio_data bytea;
