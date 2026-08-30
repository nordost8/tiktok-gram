# music-enrichment

Picks a background track for photo-only posts before they publish. This
service is the async job runner behind the "music enrichment" hook in the
collector (`../../scripts/music_enrich_db.py`); it does not decide *whether*
a post needs music — the collector does that (see
`docs/music-enrichment.md` at the repo root).

**The recommendation logic in `app/pipeline/` is a stub.** It always returns
the same bundled placeholder track (`app/assets/sample-track.mp3`, "Намалюй
мені ніч (1966) - Example Audio", provided by the repository owner). This
lets you turn the feature on and
see the whole path — collector → this service → callback → DB → feed →
`<audio>` element — actually working end to end, before you write a real
recommender. See `app/pipeline/__init__.py` for the reference sketch of one
plausible real implementation (describe the photos → check a local track
library → otherwise search YouTube → download candidates → rank with an
LLM), and `docs/music-enrichment.md` at the repo root for the bigger picture.

## Layout

- `app/settings.py` — env-driven config, prefix `MUSIC_` (e.g. `MUSIC_REDIS_URL`).
- `app/models.py`, `app/store.py` — job model + Redis-backed queue.
- `app/api.py` — FastAPI: accepts a job, serves status + the produced mp3.
- `app/worker.py` — single serial worker: pops a job, calls the pipeline, retries, sends the callback.
- `app/callback.py` — POSTs the outcome back to the caller with retry/backoff.
- `app/pipeline/` — the stub described above.

## HTTP contract

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

## Run locally

```bash
cd services/music-enrichment
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# needs a Redis instance; the repo's root docker-compose already runs one
export MUSIC_REDIS_URL=redis://localhost:6379/0
python run.py api      # in one terminal
python run.py worker   # in another
```

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `MUSIC_REDIS_URL` | `redis://localhost:6379/0` | Job queue + job store |
| `MUSIC_WORK_DIR` | `/data/jobs` | Where uploaded photos + the picked mp3 are written |
| `MUSIC_PUBLIC_BASE_URL` | `http://localhost:8090` | Used to build the callback's `download_url` |
| `MUSIC_BIND` / `MUSIC_PORT` | `0.0.0.0` / `8090` | API bind address |
| `MUSIC_MAX_IMAGES` | `10` | Max photos per job |
| `MUSIC_MAX_ATTEMPTS` | `3` | Pipeline retries before a job is marked `failed` |
| `MUSIC_CALLBACK_MAX_RETRIES` / `MUSIC_CALLBACK_BACKOFF_BASE` | `5` / `1.5` | Callback retry/backoff |
| `MUSIC_LOG_LEVEL` | `INFO` | Log level |
| `MUSIC_SKIP_MYPY` | unset | Skip the mypy gate on boot (set by the Docker image; the gate already ran at build time) |
