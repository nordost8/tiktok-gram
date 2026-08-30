# Music enrichment

Photo-only posts can optionally get a background audio track attached so
they feel less bare in a video-first feed. This document is the full, honest
story: what's real, what's a stub, and how to replace the stub with a real
recommender.

## Background: why this is a stub at all

The original version of this project picked tracks by driving **TikTok's own
"For You" sound recommender** through a cloud Android emulator with
UI-automation (screen-scraping the TikTok app). It worked, but it was
fragile — it broke outright whenever TikTok changed its app UI — and it's not
something to hand to a stranger cloning this repo. That whole approach has
been deleted. What's here instead is a deliberately honest stand-in: a fully
working pipeline around a placeholder recommendation step.

## What's real

Everything **except** "how do we pick a good track" is real, tested,
working code:

- **The gate**: the collector decides whether a post *needs* music at
  ingest time — a qualifying post is one with only photo media (no
  video/animation) once `MUSIC_ENRICHMENT_ENABLED=1`. See
  `scripts/music_enrich_db.py` and the `music_needed` state below.
- **The state machine**: `telegram_post_descriptions.status` (unified post
  lifecycle, see `packages/db/src/schema.ts`) moves a qualifying photo post
  through `caching → needs_audio → fetching_audio → ready | failed`. The feed
  only ever shows `status = 'ready'` posts, so an unenriched or failed photo
  post simply doesn't appear rather than appearing silent.
- **The job queue and HTTP contract** (`services/music-enrichment/`, a
  standalone FastAPI service):
  ```
  POST /v1/music-jobs        multipart: images[] (1..10), callback_url,
                              idempotency_key, priority, post_caption
                          →   202 {"job_id": "<12 alnum chars>", "status": "queued"}

  POST <callback_url>?desc_id=<uuid>   (fired by the worker, async)
                          →   {job_id, status, top: {title, author, ...}, download_url, error}

  GET  /jobs/{job_id}/track.mp3   → audio/mpeg
  GET  /v1/music-jobs/{job_id}    → job status
  GET  /health
  ```
- **The retry/callback machinery** (`app/worker.py`, `app/callback.py`): up to
  `MUSIC_MAX_ATTEMPTS` (default 3) pipeline retries, then callback
  retry/backoff before giving up.
- **The DB columns**: `audio_title`, `audio_author`, `audio_storage_key`,
  `audio_attempts`, `audio_last_error`, `audio_updated_at` on
  `telegram_post_descriptions` (see
  `packages/db/scripts/migrate-post-music-enrichment.sql`). The track is a
  property of the *post*, not of an individual photo — a carousel shares one
  description across many photo media rows and gets one recommended track
  for the whole set.
- **The feed UI**: a real `<audio>` element with a mute button, wired up once
  a post reaches `status = 'ready'` with audio populated.
- **The reconciler**: the `music-enrich` cron container claims posts stuck in
  `needs_audio` and retries jobs stuck in `fetching_audio` past
  `MUSIC_PENDING_STUCK_MINUTES` — a pure no-op/dry-run when
  `MUSIC_ENRICHMENT_ENABLED` isn't `1`.

## What's a stub

`services/music-enrichment/app/pipeline/pick_track_for_images()` — the *only*
function the worker calls — ignores its input entirely and always returns
the same bundled placeholder track:
`services/music-enrichment/app/assets/sample-track.mp3`, "Намалюй мені ніч
(1966) - Example Audio" ([source](https://youtu.be/PbPL1uChWfQ)), provided by
the repository owner. **This means: turn on
`MUSIC_ENRICHMENT_ENABLED=1` and every enriched photo post gets this one
same track.** That's by design — it proves the entire pipeline (collector
hook → job queue → callback → DB → feed `<audio>` element) works end to end
before you write a real recommender, rather than either faking a recommender
or leaving the feature entirely unimplemented and untestable.

The rest of the `app/pipeline/` package is a **reference sketch**, not code
that runs. Each module raises `NotImplementedError` and documents its
intended contract:

| Module | Intended job |
|---|---|
| `describe_images.py` | Describe the photos' content/mood with a vision-capable LLM. |
| `track_index.py` | Check a local library of tracks + embeddings for an existing good match (fast path). |
| `build_query.py` | Turn the description into a search query for finding new candidate tracks. |
| `search_youtube.py` | Fetch ~10 candidate videos for that query. |
| `download_audio.py` | Pull audio for each candidate. |
| `rank_tracks.py` | Hand the description + downloaded candidates to an LLM and pick the best fit. |

None of these six are called by anything today — they exist purely to show
the shape of one plausible real implementation.

## Building a real one

Replace the body of `pick_track_for_images()` in
`services/music-enrichment/app/pipeline/__init__.py` — it's the only function
the worker calls, so nothing else in the service needs to change. A real
implementation would look roughly like the six-step sketch above (or use a
completely different approach — commercial licensed-music APIs, a curated
local library, etc.). It must return a `TrackCandidate(title, author,
audio_path, source_url, license)` or `None`.

## The explicit warning

From the service's own README
(`services/music-enrichment/README.md`): **if you flip
`MUSIC_ENRICHMENT_ENABLED=1` without implementing a real pipeline, every
enriched photo post just gets the same placeholder track.** That's fine for
demoing or developing against the feature, but don't ship it to real users
expecting personalized music without doing the work in
`app/pipeline/__init__.py` first.
