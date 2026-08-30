-- Unify the post lifecycle into ONE source of truth: telegram_post_descriptions.status
--
-- Before: visibility was derived from (a) per-media cache_status + (b) per-post
-- audio_cache_status — two signals, no single "what's with this post" field.
-- After: a single `status` column answers it:
--   caching        → media still downloading to R2 (not showable)        [HIDDEN]
--   needs_audio    → photo-only post, media ready, awaiting music         [HIDDEN]
--   fetching_audio → music pick in progress                              [HIDDEN]
--   ready          → showable (video: media cached; photo: media+music)  [VISIBLE]
--   failed         → music failed 3× (photo only)                        [HIDDEN]
--
-- The feed shows iff status='ready'. Video/mixed posts (have video media) go
-- caching→ready as soon as media caches; photo posts go caching→needs_audio→
-- fetching_audio→ready|failed.
--
-- Run once: psql "$POSTGRES_URL" -f packages/db/scripts/migrate-post-status-unify.sql
-- (audio_cache_status is kept for now and dropped in a follow-up once verified.)

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'telegram_post_status') THEN
    CREATE TYPE telegram_post_status AS ENUM (
      'caching', 'needs_audio', 'fetching_audio', 'ready', 'failed'
    );
  END IF;
END
$$;

ALTER TABLE telegram_post_descriptions
  ADD COLUMN IF NOT EXISTS status telegram_post_status NOT NULL DEFAULT 'caching';

-- ── Backfill to mirror CURRENT visibility EXACTLY ────────────────────────────
-- A post is visible today iff it has a ready media row (with access hash) AND the
-- photo-music gate passes (has video/animation media OR audio_cache_status='ready').

-- (1) Video/mixed posts: ready once they have a ready+hash video/animation media row.
UPDATE telegram_post_descriptions d SET status = 'ready'
WHERE status = 'caching'
  AND EXISTS (
    SELECT 1 FROM telegram_post_media m
    WHERE m.desc_id = d.id
      AND m.type IN ('video', 'animation')
      AND m.cache_status = 'ready'
      AND m.telegram_access_hash IS NOT NULL
  );

-- (2) Photo-only posts: map straight from the audio lifecycle.
UPDATE telegram_post_descriptions d SET status =
    CASE d.audio_cache_status
      WHEN 'ready'         THEN 'ready'
      WHEN 'music_pending' THEN 'fetching_audio'
      WHEN 'music_needed'  THEN 'needs_audio'
      WHEN 'failed'        THEN 'failed'
      ELSE 'caching'
    END::telegram_post_status
WHERE NOT EXISTS (
        SELECT 1 FROM telegram_post_media m
        WHERE m.desc_id = d.id AND m.type IN ('video', 'animation'))
  AND EXISTS (
        SELECT 1 FROM telegram_post_media m
        WHERE m.desc_id = d.id AND m.type = 'photo');

CREATE INDEX IF NOT EXISTS telegram_post_descriptions_status_idx
  ON telegram_post_descriptions (status);

COMMIT;
