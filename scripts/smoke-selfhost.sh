#!/usr/bin/env sh
# CI smoke test for the Docker Compose setup: start the stack, create the admin, upload an image to
# object storage, read it back, and check the web app is served.
set -eu
cd "$(dirname "$0")/.."
base="http://localhost:${VELLUM_PORT:-8787}"
jar=$(mktemp)
trap 'rm -f "$jar"' EXIT

i=0
until curl -fsS "$base/api/health" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { docker compose logs; exit 1; }
  sleep 2
done

curl -fsS "$base/" | grep -q "<title>Vellum" || { echo "web app not served"; exit 1; }
curl -fsS -c "$jar" -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","name":"Admin","password":"a long enough password"}' "$base/api/setup" >/dev/null

# A 1x1 PNG.
png=$(mktemp)
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$png"
url=$(curl -fsS -b "$jar" -H 'content-type: image/png' -H 'x-vellum-upload: 1' --data-binary @"$png" "$base/api/uploads" |
  sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
[ -n "$url" ] || { echo "upload failed"; docker compose logs vellum; exit 1; }
curl -fsS "$base$url" | cmp -s - "$png" || { echo "uploaded image didn't round-trip"; exit 1; }

docker compose restart vellum >/dev/null
i=0
until curl -fsS "$base/api/health" >/dev/null 2>&1; do i=$((i + 1)); [ "$i" -gt 60 ] && exit 1; sleep 2; done
curl -fsS "$base/api/instance" | grep -q '"setupRequired":false' || { echo "data didn't survive a restart"; exit 1; }
curl -fsS "$base$url" | cmp -s - "$png" || { echo "image lost after restart"; exit 1; }
echo "Self-hosting smoke test passed."
