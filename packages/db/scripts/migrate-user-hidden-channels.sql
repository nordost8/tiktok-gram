-- Per-user hidden channels (feed filter). Run once on prod:
--   psql "$POSTGRES_URL" -f packages/db/scripts/migrate-user-hidden-channels.sql

BEGIN;

CREATE TABLE IF NOT EXISTS telegram_user_hidden_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES telegram_app_profiles(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_user_hidden_channels_profile_channel_idx
  ON telegram_user_hidden_channels (profile_id, channel_id);

COMMIT;
