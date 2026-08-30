#!/bin/bash
# Runs the tiktok-gram collector inside Docker (no host Python/Node).
set -euo pipefail

TIKTOK_GRAM_DIR="${TIKTOK_GRAM_DIR:-$HOME/tiktok-gram}"

if [ -x "$TIKTOK_GRAM_DIR/scripts/tiktok-gram-git-pull.sh" ]; then
  TIKTOK_GRAM_DIR="$TIKTOK_GRAM_DIR" bash "$TIKTOK_GRAM_DIR/scripts/tiktok-gram-git-pull.sh" || true
fi

cd "$TIKTOK_GRAM_DIR/deploy/pi"
/usr/bin/docker compose --profile cron run --rm collector
