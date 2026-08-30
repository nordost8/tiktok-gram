#!/bin/bash
# tiktok-gram stack: postgres + redis + web + media-worker + caddy.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$HOME/tiktok-gram/deploy/pi}"

cd "$DEPLOY_DIR"
docker compose up -d
echo "tiktok-gram-pi-up: stack started (http://127.0.0.1:${TIKTOK_GRAM_HTTP_PORT:-3090})"
docker compose ps
