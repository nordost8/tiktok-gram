-- Store the music-enrichment track picked for an image-only / photo-carousel post.
--
-- The track is a property of the POST (the description), not of an individual
-- media row: a carousel shares one description across many photo media, and the
-- music service returns a single recommended sound for the whole image set.
--
-- All columns are NULLable / additive (audio_cache_status defaults to 'none',
-- audio_attempts to 0), so this migration is non-breaking: posts without music
-- (every post today — the feature is off by default) keep audio_cache_status =
-- 'none' and the feed renders exactly as before.
--
-- Idempotent / additive / re-runnable: every statement is guarded
-- (IF NOT EXISTS / ADD VALUE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--
-- Target: PostgreSQL 17 (container postgres:17-alpine).
--
-- Run once: psql "$POSTGRES_URL" -f packages/db/scripts/migrate-post-music-enrichment.sql

-- Lifecycle of the post's audio track (owner-locked 2026-06-19):
--   none         → not a qualifying photo post (video posts; the default) —
--                  never music-gated, behaves exactly like today.
--   music_needed  → qualifying photo-only post, formed but awaiting music.  [HIDDEN]
--   music_pending → a worker took it; the pick is in progress.              [HIDDEN]
--   ready         → mp3 stored in R2 (audio_storage_key set) + title/author
--                   written.                                               [VISIBLE]
--   failed        → 3 attempts exhausted; audio_last_error set. Kept distinct
--                   for observability/reprocessing; logged loudly.   [HIDDEN, loud]
--
-- audio_cache_status ALONE drives the state machine; tiktok_music_job_id is a
-- non-gating debug breadcrumb. Transitions:
--   ingest (collector):  qualifying photo-only post → 'music_needed'.
--   claim (hook/cron):   'music_needed' → 'music_pending', audio_attempts++.
--   callback done:       'music_pending' → 'ready'.
--   callback failed:     audio_attempts < 3 ? back to 'music_needed' : 'failed'.

-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
-- PG, so the enum create/upgrade is done OUTSIDE the BEGIN/COMMIT below. On a fresh
-- DB the CREATE TYPE lists all 5 values; the rename + ADD VALUE handle DBs created
-- by earlier versions of this migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'telegram_post_audio_status') THEN
    CREATE TYPE telegram_post_audio_status AS ENUM (
      'none', 'music_needed', 'music_pending', 'ready', 'failed'
    );
  END IF;
END
$$;

-- Rename the legacy 'pending' label to 'music_pending' (existing prod DBs). RENAME
-- VALUE relabels in place, so existing rows follow automatically. Guarded so it's a
-- no-op on fresh DBs / re-runs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'telegram_post_audio_status' AND e.enumlabel = 'pending')
     AND NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'telegram_post_audio_status' AND e.enumlabel = 'music_pending') THEN
    ALTER TYPE telegram_post_audio_status RENAME VALUE 'pending' TO 'music_pending';
  END IF;
END
$$;

-- Forward-compat: ensure the full value set exists (no-op when already present).
ALTER TYPE telegram_post_audio_status ADD VALUE IF NOT EXISTS 'none';
ALTER TYPE telegram_post_audio_status ADD VALUE IF NOT EXISTS 'music_needed' AFTER 'none';
ALTER TYPE telegram_post_audio_status ADD VALUE IF NOT EXISTS 'music_pending';
ALTER TYPE telegram_post_audio_status ADD VALUE IF NOT EXISTS 'ready';
ALTER TYPE telegram_post_audio_status ADD VALUE IF NOT EXISTS 'failed';

BEGIN;

ALTER TABLE telegram_post_descriptions
  ADD COLUMN IF NOT EXISTS audio_title text,
  ADD COLUMN IF NOT EXISTS audio_author text,
  ADD COLUMN IF NOT EXISTS audio_storage_key text,
  ADD COLUMN IF NOT EXISTS audio_cache_status telegram_post_audio_status NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS audio_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tiktok_music_job_id text,
  ADD COLUMN IF NOT EXISTS audio_last_error text,
  ADD COLUMN IF NOT EXISTS audio_updated_at timestamptz;

-- Lets the enrichment trigger find posts already in flight (idempotency safety
-- net in addition to the service-side idempotency_key) and the feed query skip
-- posts with no audio cheaply.
CREATE INDEX IF NOT EXISTS telegram_post_descriptions_audio_status_idx
  ON telegram_post_descriptions (audio_cache_status);

-- One music job per post: the service idempotency_key already dedupes, but this
-- guards the DB side against two callbacks/triggers racing on the same desc.
CREATE UNIQUE INDEX IF NOT EXISTS telegram_post_descriptions_music_job_idx
  ON telegram_post_descriptions (tiktok_music_job_id)
  WHERE tiktok_music_job_id IS NOT NULL;

COMMIT;
