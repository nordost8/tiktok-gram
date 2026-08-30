# Setup: deploy (e.g. to a Raspberry Pi)

The whole stack is a single self-contained `docker-compose.yml` — its own
Postgres and Redis, Caddy as reverse proxy, the Next.js app, the media
worker, the collector and media-cleanup (run via cron, not long-running),
and the music-enrichment service. Everything below assumes Docker + Docker
Compose are already installed on the target host.

## 1. Configure

```bash
cp deploy/pi/.env.example deploy/pi/.env
```

Fill in `deploy/pi/.env`:

- `POSTGRES_PASSWORD` — pick a real password (the compose file refuses to
  start without one: `${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}`).
- `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET` —
  see [`docs/setup/cloudflare-r2.md`](cloudflare-r2.md).
- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_BOT_TOKEN` — see
  [`docs/setup/telegram.md`](telegram.md). You can leave the userbot's
  `TELEGRAM_PHONE`/`TELEGRAM_LOGIN_CODE`/`TELEGRAM_2FA_PASSWORD` unset until
  the one-time login step below.
- `TIKTOK_GRAM_HTTP_PORT` (default `3090`) and `TIKTOK_GRAM_SITE_ADDRESS` —
  either leave `TIKTOK_GRAM_SITE_ADDRESS=:80` and put a tunnel (e.g.
  Cloudflare Tunnel) in front of `TIKTOK_GRAM_HTTP_PORT`, or set it to a real
  domain plus `ACME_EMAIL` for Caddy to fetch its own TLS cert directly.
- `LOCALE` (`en` or `uk`) — see [`docs/i18n.md`](../i18n.md).

## 2. Database schema

```bash
pnpm db:push
```

`pnpm db:push` (Drizzle Kit, against `packages/db/src/schema.ts`) creates the
full current schema — every table, enum, and column described in
`schema.ts` — directly against `POSTGRES_URL`. This is the only schema step a
**fresh install** needs.

`packages/db/scripts/*.sql` is a set of hand-written, additive
(`ADD COLUMN IF NOT EXISTS` style) SQL migrations that were used to evolve an
already-running production database incrementally as the schema changed over
time — they are **not** required to bring up a brand-new database, since
`schema.ts` (and therefore `db:push`) already reflects their end state. They're
kept in the repo as a record of that history and for anyone migrating an
existing pre-refactor database. If you're doing that, read each file's header
comment for its exact preconditions before running it — see the note at the
bottom of this page about one of them that no longer matches the current
schema at all.

## 3. Bring the stack up

```bash
cd deploy/pi
docker compose up -d --build
```

This starts `postgres`, `redis`, `caddy`, `web`, `media-worker`, and
`music-callback`. `collector`, `media-cleanup`, and `music-enrich` are
one-shot containers under the `cron` profile and don't start automatically.

## 4. Log in to the Telegram userbot (one time)

With the stack up, fill `TELEGRAM_PHONE` in `.env`, restart `web`/`media-worker`
if needed, and follow [`docs/setup/telegram.md`](telegram.md)'s login flow
(`pnpm telegram:channels`) — either from your dev machine pointed at the same
`POSTGRES_URL`, or by running it inside the `media-worker` container. The
session ends up in the `telegram_sessions` table, so this only needs doing
once regardless of which container reads it afterwards.

Add at least one channel (see [`docs/setup/channels.md`](channels.md)), then
run a first ingest:

```bash
docker compose --profile cron run --rm collector
```

## 5. Schedule the recurring jobs

The collector, media cleanup, and (if you're using music enrichment) the
reconciler are meant to run on a schedule via host cron, not as long-running
containers. Wrapper scripts are provided:

- `scripts/tiktok-gram-collector-cron.sh` — `docker compose --profile cron run --rm collector`
- `scripts/tiktok-gram-media-cleanup-cron.sh` — `docker compose --profile cron run --rm media-cleanup`
- `scripts/music-enrich-cron.sh` — `docker compose --profile cron run --rm music-enrich`
- `scripts/tiktok-gram-git-pull.sh` — `git fetch` + fast-forward merge, for hosts tracking a git remote

### Automating it with `scripts/setup-pi-cron.sh`

If you're deploying to a remote host over SSH, `scripts/setup-pi-cron.sh`
syncs `docker/`, `deploy/`, and `scripts/` to the remote host, builds the
images there, brings the stack up, and installs the cron schedule (git pull
every 5 min, collector every 15 min, media cleanup daily at 04:15) —
all in one run:

```bash
DEPLOY_USER=<remote ssh user> \
DEPLOY_HOST=<remote hostname or IP> \
DEPLOY_DIR=/home/<remote ssh user>/tiktok-gram \
bash scripts/setup-pi-cron.sh
```

This script **requires passwordless SSH key auth to the target host already
set up** — it never handles a password, and will simply fail on a password
prompt. `DEPLOY_DIR` defaults to `/home/$DEPLOY_USER/tiktok-gram` if unset.
It copies `deploy/pi/.env` from your local checkout to the remote host as
part of the sync, so fill it in locally first.

## Migration file note

`packages/db/scripts/migrate-post-awaiting-cache.sql` references a
`telegram_posts` table and a `primary_media_id` column that do not exist
anywhere in the current `packages/db/src/schema.ts` (posts live in
`telegram_post_descriptions`, and the feed picks primary media via a `LATERAL`
query rather than a stored `primary_media_id`). It appears to predate a
schema refactor and does not match this codebase's current shape — don't run
it against a database created from the current `schema.ts`.
