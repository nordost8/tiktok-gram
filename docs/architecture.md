# Architecture

This is the deeper version of the README's architecture section: the full
request/data flow, what runs where, what's stateful vs. stateless, and what
each service in [`deploy/pi/docker-compose.yml`](../deploy/pi/docker-compose.yml)
actually does.

## Data flow

```
                     ┌───────────────────────────┐
                     │   Telegram (real network)  │
                     └──────────────┬─────────────┘
                                    │ MTProto (userbot session)
                                    ▼
                     ┌───────────────────────────┐
                     │  collector (Telethon)      │  scripts/collector-sync.py
                     │  scripts/telegram-         │  scripts/telegram_collector_lib.py
                     │  collector.py              │
                     └──────────────┬─────────────┘
                                    │ writes post/media rows,
                                    │ enqueues cache jobs
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │                     Postgres                        │
        │  telegram_channels, telegram_post_descriptions,     │
        │  telegram_post_media, telegram_sessions (userbot     │
        │  auth), profiles, likes/saves/views, subscriptions   │
        └───────────┬───────────────────────────┬─────────────┘
                    │ reads job                  │ reads/writes
                    ▼                            │ via Drizzle + tRPC
        ┌───────────────────────────┐            │
        │  media-worker              │            │
        │  scripts/media_cache_job.py│            │
        │  - downloads media          │            │
        │  - ffmpeg → H.264 if needed │            │
        │  - uploads to R2 (video)    │            │
        │  - or stores bytes in PG    │            │
        │    (photo/audio)            │            │
        └──────────────┬─────────────┘            │
                       │ PUT                       │
                       ▼                            │
        ┌───────────────────────────┐              │
        │   Cloudflare R2 (video)     │              │
        └──────────────┬─────────────┘              │
                       │ presigned GET (direct,      │
                       │ never proxied)               │
                       ▼                              ▼
                     ┌─────────────────────────────────────┐
                     │        Next.js app (apps/nextjs)      │
                     │  tRPC router → feed-query.ts          │
                     │  → presigns R2 URLs for video,        │
                     │    serves photo/audio bytes itself     │
                     └──────────────────┬─────────────────────┘
                                        │ rendered inside
                                        ▼
                     ┌───────────────────────────┐
                     │   Telegram Mini App WebView │
                     └───────────────────────────┘

Optional side path — photo-only posts:
  collector marks post `needs_audio` ──▶ music-enrich job ──▶
  services/music-enrichment (FastAPI + worker) ──▶ callback ──▶
  music-callback container writes audio_* columns ──▶ post becomes `ready`
```

## Services (from `deploy/pi/docker-compose.yml`)

| Service | Stateful? | Role |
|---|---|---|
| `postgres` | Stateful (named volume) | Single source of truth: posts, media metadata, photo/audio bytes, the userbot's own login session, users, likes/saves/views/subscriptions. |
| `redis` | Stateful (named volume) | Job queues only — the media-cache queue and the music-enrichment job queue (DB 0 and DB 1). Nothing here is authoritative; losing it just means in-flight jobs get re-enqueued. |
| `caddy` | Stateless (except ACME cert cache) | Reverse proxy in front of `web`. Either plain HTTP behind a tunnel (Cloudflare Tunnel etc.) or direct HTTPS via ACME if you give it a real domain. |
| `web` | Stateless | The Next.js app. Reads `LOCALE`/`SUPPORT_URL`/etc. at request time (see [i18n](i18n.md)), serves the tRPC feed API, presigns R2 URLs, streams photo/audio bytes straight from Postgres. |
| `media-worker` | Stateless (writes only to Postgres/R2) | Pops media-cache jobs, downloads from Telegram, transcodes non-H.264 video with ffmpeg, uploads to R2 (video) or stores bytes in Postgres (photo/audio), runs the fair-eviction cache logic before/after caching. Optionally runs caption translation (fastText + any OpenAI-compatible LLM you configure — Lapa on the README diagram is just one example) when `CAPTION_TRANSLATE_ENABLED=1`. |
| `music-callback` | Stateless | A second copy of the media-worker image running only `music_enrich_callback.py` — receives the async result from the music-enrichment service and writes `audio_*` columns. Dormant (never called) unless `MUSIC_ENRICHMENT_ENABLED=1`. |
| `music-enrich` | Stateless, `profiles: [cron]` | Reconciler run on a schedule: claims posts stuck in `needs_audio`, retries stuck `fetching_audio` jobs. A pure dry-run/no-op when music enrichment is off. |
| `media-cleanup` | Stateless, `profiles: [cron]` | Runs the [media-cache eviction](media-cache.md) job once and exits. Scheduled via host cron, not a long-running container. |
| `collector` | Stateless (writes to Postgres via the userbot session stored there), `profiles: [cron]` | Runs one sync pass over active channels and exits. Scheduled via host cron. |
| `music-enrichment-api` / `music-enrichment-worker` | Stateless (job data in `redis` DB 1 + a scratch volume for in-flight files) | The standalone FastAPI service in `services/music-enrichment/` — see [Music enrichment](music-enrichment.md). |

Everything under `profiles: [cron]` is a one-shot container meant to be
triggered by host cron (`docker compose --profile cron run --rm <service>`),
not left running — see [`docs/setup/deploy.md`](setup/deploy.md).

## What's stateful vs. stateless, concretely

- **The only things that must survive a redeploy** are the `postgres_data`
  volume (all real data, including the Telegram userbot's login session —
  see [`scripts/telegram_session_pg.py`](../scripts/telegram_session_pg.py))
  and whatever is in your R2 bucket (video). Everything else — `web`,
  `media-worker`, `music-callback`, `collector`, `caddy` — can be recreated
  from the image with zero data loss.
- **Redis is disposable.** It only ever holds queued job references. If it's
  wiped, the worst case is a media job or music job needs to be re-triggered
  (the collector/backfill scripts re-enqueue anything not yet cached).
- **The Bot API bot** (`TELEGRAM_BOT_TOKEN`) is stateless on this side too —
  Telegram holds the webhook registration; re-registering it is one call
  (done automatically when `SITE_URL` is set and the app boots).

## Build vs. runtime images

Images build locally by default (`docker compose up -d --build`, run from
`deploy/pi/`). `.github/workflows/docker-ghcr.yml` optionally builds
`linux/arm64` images for `web`, `collector`, and `media-worker` on every push
to `main` and pushes them to `ghcr.io/<your-github-username>/tiktok-gram-*` —
useful if you'd rather pull prebuilt images onto a low-power host than build
there directly. The Next.js image builds on the CI runner's native platform
(AMD64) and copies over Next's standalone output, which is portable JS that
needs no ARM64 recompilation; `media-worker` and `collector` build straight
on ARM64 since they're plain Python + ffmpeg.
