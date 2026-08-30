#!/usr/bin/env bash
# Host cron helper for the music-enrichment reconciler (*/10 safety net).
# Intended crontab entry on the deploy host:
#   */10 * * * * $HOME/tiktok-gram-music-enrich-cron.sh >> $HOME/tiktok-gram-music-enrich.log 2>&1
set -euo pipefail

TIKTOK_GRAM_DIR="${TIKTOK_GRAM_DIR:-$HOME/tiktok-gram}"

cd "$TIKTOK_GRAM_DIR/deploy/pi"
/usr/bin/docker compose --profile cron run --rm music-enrich
