FROM python:3.12-slim-bookworm

WORKDIR /app

# ffmpeg: normalise non-H.264 video (AV1/HEVC) at ingest so every cached file is
# playable on every client — iOS cannot decode AV1 at all. See
# normalize_video_for_playback in media_cache_job.py.
RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    telethon \
    psycopg2-binary \
    boto3 \
    redis \
    rq \
    requests \
    fastapi \
    "uvicorn[standard]" \
    httpx \
    "numpy<2" \
    fasttext-wheel

RUN mkdir -p /app/models && \
    curl -sL -o /app/models/lid.176.ftz \
      "https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz"

ENV FASTTEXT_MODEL_PATH=/app/models/lid.176.ftz

COPY scripts/telegram_collector_lib.py \
     scripts/telegram_session_pg.py \
     scripts/media_queue_lib.py \
     scripts/media_cache_job.py \
     scripts/media_cache_cleanup.py \
     scripts/photo_pg_storage.py \
     scripts/media_cache_worker.py \
     scripts/media-cache-cleanup-run.py \
     scripts/media-cache-backfill.py \
     scripts/music_enrich.py \
     scripts/music_enrich_db.py \
     scripts/music_enrich_callback.py \
     scripts/music_enrich_cron.py \
     scripts/caption_lang.py \
     scripts/caption_translate_lapa.py \
     scripts/caption_translate_db.py \
     scripts/test_caption_translate_e2e.py \
     scripts/test_caption_lang.py \
     /app/scripts/

ENV PYTHONPATH=/app/scripts

RUN mkdir -p /app/logs

CMD ["python", "/app/scripts/media_cache_worker.py"]
