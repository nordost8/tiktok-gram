# Media cache: per-channel fair eviction

Video is the only media type this cache manages. Photos and audio are stored
as `bytea` directly in Postgres (see `photo_pg_storage.py` and the
`audio_data` column in `packages/db/src/schema.ts`) and are outside this
budget entirely. This document describes the real algorithm in
[`scripts/media_cache_cleanup.py`](../scripts/media_cache_cleanup.py) and
[`scripts/media_cache_job.py`](../scripts/media_cache_job.py) — not an
idealized version of it.

## The budget

- `MEDIA_CACHE_BUDGET_BYTES` — default **9,800,000,000 bytes (9.8 GB)**. This
  is deliberately just under Cloudflare R2's 10 GB free-tier storage
  allowance, to absorb R2's decimal-byte accounting without ever crossing
  into billed storage.
- Only media with `cache_status = 'ready'`, a non-null `cached_size_bytes`,
  and `storage_backend = 'r2'` counts toward the total (photos stored with
  `storage_backend = 'postgres'` are excluded).
- `MEDIA_CACHE_MAX_BYTES` — default **250 MB** — is a separate, per-file cap
  applied when a single item is first downloaded: anything larger is skipped
  rather than cached at all (see `max_cache_bytes()` in `media_cache_job.py`).

## The "fair" part: per-channel protection window

Eviction is oldest-first (`ORDER BY published_at ASC`) across *all* cached
video, **except** it never touches media belonging to a channel's own most
recent posts. Concretely (`list_eviction_candidates_v2` in
`media_cache_cleanup.py`):

```sql
-- For every ACTIVE channel, rank its posts by published_at DESC and
-- protect the top MEDIA_CACHE_PROTECT_PER_CHANNEL (default 5) from eviction.
```

Without this, a single high-volume channel could flush every other channel's
recent posts out of cache just by posting a lot of video. With it, every
active channel is guaranteed to keep its own latest `MEDIA_CACHE_PROTECT_PER_CHANNEL`
(default 5, env `MEDIA_CACHE_PROTECT_PER_CHANNEL`) posts cached regardless of
how much other channels post — eviction pressure only ever falls on posts
outside that per-channel window, oldest first.

If every cached item happens to be inside some channel's protection window
(all channels newly added, or the window set too wide relative to the
budget), there are no eviction candidates at all — the job logs a loud
warning and storage stays over budget rather than silently violating the
protection guarantee. The fix suggested in that log line is to lower
`MEDIA_CACHE_PROTECT_PER_CHANNEL` or remove inactive channels.

## When eviction runs

Two triggers, both calling the same candidate list and the same `evict_media()`:

1. **Proactive**, inside the media-worker, right before caching a new file
   (`_evict_to_fit()` in `media_cache_job.py`): if `current_cached_bytes +
   incoming_file_bytes > budget`, it evicts oldest unprotected candidates
   until there's room, *then* downloads/uploads the new file.
2. **Scheduled**, via the one-shot `media-cleanup` container
   (`docker compose --profile cron run --rm media-cleanup`, wired to
   `scripts/media-cache-cleanup-run.py` → `run_media_cache_cleanup()`), run
   from host cron once a day (see [`docs/setup/deploy.md`](setup/deploy.md)).
   This is the safety net for drift the proactive path might miss.

Both stop as soon as the running total is back under budget, or the
candidate list is exhausted — whichever comes first.

## What eviction actually does

For each candidate, oldest first:

1. Read `cached_size_bytes` for the media row; if it's not `ready` anymore
   (raced with something else), skip it.
2. Delete the object from the R2 bucket (`s3.delete_object`; a `NoSuchKey`/404
   is treated as already-gone, not an error).
3. Set the media row's `cache_status` back to `needs_cache` and clear its
   storage key (`update_media_cache_status(..., clear_storage=True)`).

Evicting doesn't delete the post — it just un-caches its video. The post
falls out of the feed (the feed only serves `cache_status = 'ready'` media)
until something re-triggers caching for it (a backfill run, or the post
being requested again).

## Logging

Every run logs to `TIKTOK_GRAM_MEDIA_LOG` (mounted at
`/app/logs/media-worker.log` in the containers): starting total vs. budget,
whether it's over budget and by how much, each eviction with bytes freed and
the running total, and a final summary. `[cleanup]` prefixes the scheduled
job's lines, `[budget]` prefixes the proactive path's lines.

## Related env vars

| Var | Default | Meaning |
|---|---|---|
| `MEDIA_CACHE_BUDGET_BYTES` | `9800000000` | Total R2-cached video budget in bytes. |
| `MEDIA_CACHE_PROTECT_PER_CHANNEL` | `5` | Newest N posts per active channel that eviction will never touch. |
| `MEDIA_CACHE_PROTECT_POSTS` | `40` | Defined (`protect_post_count()`) but not actually referenced anywhere in the current eviction path — the real protection logic is entirely per-channel (`MEDIA_CACHE_PROTECT_PER_CHANNEL`). Appears to be a leftover from an earlier single-global-window design; setting it currently has no effect. |
| `MEDIA_CACHE_MAX_BYTES` | `262144000` (250 MB) | Per-file cap; larger files are skipped, not cached. |
