#!/usr/bin/env bash
# Pull latest tiktok-gram code on the deploy host (run from cron after a git push).
set -euo pipefail

TIKTOK_GRAM_DIR="${TIKTOK_GRAM_DIR:-$HOME/tiktok-gram}"
LOG="${TIKTOK_GRAM_GIT_PULL_LOG:-$HOME/tiktok-gram-git-pull.log}"

if [ ! -d "$TIKTOK_GRAM_DIR/.git" ]; then
  echo "$(date -Is) skip: $TIKTOK_GRAM_DIR is not a git clone" >>"$LOG"
  exit 0
fi

cd "$TIKTOK_GRAM_DIR"
BRANCH="${TIKTOK_GRAM_GIT_BRANCH:-main}"

{
  echo "$(date -Is) git pull origin $BRANCH"
  git fetch origin "$BRANCH"

  # Stash any local modifications so ff-only merge never blocks.
  STASHED=0
  if ! git diff --quiet HEAD 2>/dev/null; then
    git stash push -m "auto-stash before git pull $(date -Is)"
    STASHED=1
  fi

  git merge --ff-only "origin/$BRANCH"

  # Drop the stash — pulled code supersedes the local modifications.
  if [ "$STASHED" -eq 1 ]; then
    git stash drop || true
  fi
} >>"$LOG" 2>&1
