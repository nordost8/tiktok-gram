-- Permanent media-playback telemetry (survives container recreation AND profile
-- deletion). The frontend beacons every "shown"/"error" outcome here so we can
-- diagnose "why did this video fail for this user" from data instead of guesses.
--
-- No foreign key on profile_id on purpose: rows are kept forever for diagnostics.

CREATE TABLE IF NOT EXISTS media_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid,
  outcome     varchar(16) NOT NULL,
  post_id     text,
  media_id    text,
  media_type  varchar(16),
  channel     text,
  cache_status varchar(32),
  reason      text,
  src_kind    varchar(32),
  media_url   text,
  attempt     integer,
  load_ms     integer,
  user_agent  text,
  extra       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_events_outcome_created_idx
  ON media_events (outcome, created_at);
CREATE INDEX IF NOT EXISTS media_events_created_idx
  ON media_events (created_at);
CREATE INDEX IF NOT EXISTS media_events_post_idx
  ON media_events (post_id);
