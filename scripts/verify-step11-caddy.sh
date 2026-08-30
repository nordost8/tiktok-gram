#!/usr/bin/env bash
# Validate Pi Caddy + compose stack (no Raspberry Pi required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PI_DIR="$ROOT/deploy/pi"
CADDY_IMAGE="caddy:2.11.3-alpine"
SMOKE_CADDYFILE="$(mktemp)"
CREATED_ENV=0

cleanup() {
  rm -f "$SMOKE_CADDYFILE"
  if [[ "$CREATED_ENV" == 1 ]]; then
    rm -f "$PI_DIR/.env"
  fi
  docker rm -f "$CADDY" "$MOCK" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

MOCK=""
CADDY=""
NET=""

echo "[verify-caddy] compose config…"
if [[ ! -f "$PI_DIR/.env" ]]; then
  cp "$PI_DIR/.env.example" "$PI_DIR/.env"
  CREATED_ENV=1
fi
docker compose -f "$PI_DIR/docker-compose.yml" config >/dev/null

echo "[verify-caddy] caddy validate (production Caddyfile)…"
docker run --rm \
  -e TIKTOK_GRAM_SITE_ADDRESS=":80" \
  -e ACME_EMAIL="test@example.com" \
  -v "$PI_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" \
  caddy validate --config /etc/caddy/Caddyfile

echo "[verify-caddy] caddy reverse-proxy smoke…"
MOCK="tiktok-gram-verify-mock-$$"
CADDY="tiktok-gram-verify-caddy-$$"
NET="tiktok-gram-verify-net-$$"

cat >"$SMOKE_CADDYFILE" <<EOF
:18080 {
  reverse_proxy ${MOCK}:80
}
EOF

docker network create "$NET" >/dev/null
docker run -d --name "$MOCK" --network "$NET" nginx:alpine >/dev/null

docker run -d --name "$CADDY" --network "$NET" -p 18080:18080 \
  -v "$SMOKE_CADDYFILE:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" \
  caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

for _ in $(seq 1 24); do
  if curl -sf "http://127.0.0.1:18080/" | grep -qi nginx; then
    echo '{"ok":true,"composeConfig":true,"caddyValidate":true,"caddySmoke":"http://127.0.0.1:18080/"}'
    exit 0
  fi
  sleep 0.25
done

echo "Caddy smoke test failed" >&2
exit 1
