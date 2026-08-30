-- Auto-translation of non-Ukrainian post captions for the feed.
-- Original text/caption columns are immutable; text_display_uk holds the translation.

DO $$ BEGIN
  CREATE TYPE telegram_caption_translation_status AS ENUM (
    'none', 'skipped', 'pending', 'ready', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE telegram_post_descriptions
  ADD COLUMN IF NOT EXISTS source_lang varchar(16),
  ADD COLUMN IF NOT EXISTS text_display_uk text,
  ADD COLUMN IF NOT EXISTS caption_translation_status telegram_caption_translation_status NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS caption_translate_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS caption_translate_error text,
  ADD COLUMN IF NOT EXISTS caption_translated_at timestamptz;

CREATE INDEX IF NOT EXISTS telegram_post_descriptions_caption_translation_status_idx
  ON telegram_post_descriptions (caption_translation_status);
