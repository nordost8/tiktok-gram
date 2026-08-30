#!/bin/bash
# tiktok-gram media cache cleanup via Docker (no host Python).
set -euo pipefail

TIKTOK_GRAM_DIR="${TIKTOK_GRAM_DIR:-$HOME/tiktok-gram}"
cd "$TIKTOK_GRAM_DIR/deploy/pi"
/usr/bin/docker compose --profile cron run --rm media-cleanup
