#!/usr/bin/env bash
# Deploy the tiktok-gram stack to a remote host over SSH — Docker only (no
# host venv / pip). Requires passwordless SSH key auth to the target host
# (see docs/setup/deploy.md); this script intentionally never handles a
# password.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_USER="${DEPLOY_USER:?set DEPLOY_USER (the remote SSH user)}"
DEPLOY_HOST="${DEPLOY_HOST:?set DEPLOY_HOST (the remote hostname or IP)}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/$DEPLOY_USER/tiktok-gram}"
SSH_TARGET="$DEPLOY_USER@$DEPLOY_HOST"

run_ssh() {
  ssh -o StrictHostKeyChecking=accept-new "$SSH_TARGET" "$@"
}

echo "-> Sync deploy files to $DEPLOY_DIR"
run_ssh "mkdir -p $DEPLOY_DIR/docker/collector $DEPLOY_DIR/docker/nextjs $DEPLOY_DIR/docker/media-worker $DEPLOY_DIR/deploy/pi $DEPLOY_DIR/scripts"

rsync -avz "$ROOT/docker/" "$SSH_TARGET:$DEPLOY_DIR/docker/"
rsync -avz "$ROOT/deploy/" "$SSH_TARGET:$DEPLOY_DIR/deploy/"
rsync -avz "$ROOT/scripts/" "$SSH_TARGET:$DEPLOY_DIR/scripts/"

scp -o StrictHostKeyChecking=accept-new "$ROOT/deploy/pi/.env" "$SSH_TARGET:$DEPLOY_DIR/deploy/pi/.env"

echo "-> Build images on the remote host (web, media-worker, collector)"
run_ssh "cd $DEPLOY_DIR/deploy/pi && docker compose build web media-worker collector"

echo "-> Start the stack (postgres, redis, caddy, web, media-worker)"
run_ssh "cd $DEPLOY_DIR/deploy/pi && docker compose up -d"

echo "-> Log in to Telegram once, if not already done"
echo "   (run: docker compose --profile cron run --rm collector, see docs/setup/telegram.md)"

echo "-> Install cron (git pull + collector + media cleanup)"
run_ssh bash -s <<REMOTE
set -e
cp $DEPLOY_DIR/scripts/tiktok-gram-collector-cron.sh /home/$DEPLOY_USER/tiktok-gram-collector-cron.sh
cp $DEPLOY_DIR/scripts/tiktok-gram-media-cleanup-cron.sh /home/$DEPLOY_USER/tiktok-gram-media-cleanup-cron.sh
cp $DEPLOY_DIR/scripts/tiktok-gram-git-pull.sh /home/$DEPLOY_USER/tiktok-gram-git-pull.sh
chmod +x /home/$DEPLOY_USER/tiktok-gram-collector-cron.sh /home/$DEPLOY_USER/tiktok-gram-media-cleanup-cron.sh /home/$DEPLOY_USER/tiktok-gram-git-pull.sh
(
  crontab -l 2>/dev/null | grep -v 'tiktok-gram-collector' | grep -v 'tiktok-gram-media-cleanup' | grep -v 'tiktok-gram-git-pull' || true
  echo '# tiktok-gram: pull latest from git'
  echo '*/5 * * * * /home/$DEPLOY_USER/tiktok-gram-git-pull.sh >> /home/$DEPLOY_USER/tiktok-gram-git-pull.log 2>&1'
  echo '# tiktok-gram: Telegram feed collector (Docker)'
  echo '*/15 * * * * /home/$DEPLOY_USER/tiktok-gram-collector-cron.sh >> /home/$DEPLOY_USER/tiktok-gram-collector.log 2>&1'
  echo '# tiktok-gram: media cache cleanup (Docker)'
  echo '15 4 * * * /home/$DEPLOY_USER/tiktok-gram-media-cleanup-cron.sh >> /home/$DEPLOY_USER/tiktok-gram-media-cleanup.log 2>&1'
) | crontab -
REMOTE

echo "Done. Only Docker + cron lines on the host."
