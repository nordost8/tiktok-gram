# music-enrichment service — single image for the api + worker roles.
# Build context = repo root. Runs the strict mypy gate at build time.
FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching)
COPY services/music-enrichment/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the full typed package (includes mypy.ini, run.py, app/)
COPY services/music-enrichment/ ./

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    MUSIC_SKIP_MYPY=1

# Run strict mypy gate at build time — image fails to build on type errors.
RUN cd /app && python -m mypy --config-file mypy.ini app run.py

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8090/health || exit 1

ENTRYPOINT ["python", "run.py"]
CMD ["api"]
