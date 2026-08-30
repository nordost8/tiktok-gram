FROM python:3.12-slim-bookworm

WORKDIR /app

RUN pip install --no-cache-dir telethon psycopg2-binary redis rq boto3

COPY scripts/telegram_collector_lib.py scripts/telegram_session_pg.py \
     scripts/telegram-collector.py scripts/collector-sync.py \
     scripts/media_queue_lib.py scripts/media_cache_job.py scripts/media-cache-enqueue.py \
     scripts/channel_avatar_cache.py \
     scripts/cleanup-unsubscribed-channels.py \
     /app/scripts/

ENV PYTHONPATH=/app/scripts
ENV COLLECTOR_LIMIT=15

CMD ["python", "/app/scripts/collector-sync.py"]
