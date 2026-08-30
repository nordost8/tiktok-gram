#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== step 2 db =="
pnpm -F @tiktok-gram/db test
pnpm -F @tiktok-gram/db verify

echo "== step 3 seed =="
pnpm -F @tiktok-gram/db verify:seed

echo "== step 4 api =="
pnpm api:verify

echo "== steps 5-8 ui api =="
pnpm api:verify:ui

echo "== nextjs typecheck =="
pnpm -F @tiktok-gram/nextjs typecheck

echo "== step 9 acceptance =="
pnpm -F @tiktok-gram/api verify:step9

echo "== step 1 page =="
code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/telegram)
test "$code" = "200"

echo '{"ok":true,"all":"passed"}'
