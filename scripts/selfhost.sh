#!/usr/bin/env sh
# One-command self-hosting: creates .env with random storage keys on first run, then starts Vellum.
#   ./scripts/selfhost.sh            start (or update) Vellum
#   ./scripts/selfhost.sh --build    build the image from this checkout instead of pulling it
set -eu
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required: https://docs.docker.com/get-docker/" >&2
  exit 1
fi

random() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

if [ ! -f .env ]; then
  sed -e "s/^STORAGE_ACCESS_KEY=.*/STORAGE_ACCESS_KEY=vellum$(random 12)/" \
      -e "s/^STORAGE_SECRET_KEY=.*/STORAGE_SECRET_KEY=$(random 40)/" \
      .env.example > .env
  chmod 600 .env
  echo "Created .env with random storage keys. Review VELLUM_PUBLIC_URL before exposing Vellum."
fi

if [ "${1:-}" = "--build" ]; then
  docker compose up -d --build
else
  if ! docker compose pull --quiet vellum storage; then
    echo "Couldn't pull the Vellum image; building it from this checkout."
    docker compose build vellum
  fi
  docker compose up -d
fi

port=$(grep -E '^VELLUM_PORT=' .env | cut -d= -f2)
url=$(grep -E '^VELLUM_PUBLIC_URL=' .env | cut -d= -f2-)
printf "Waiting for Vellum"
i=0
until curl -fsS "http://localhost:${port:-8787}/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo
    echo "Vellum didn't start. Check: docker compose logs vellum" >&2
    exit 1
  fi
  printf "."
  sleep 2
done
echo
echo "Vellum is running at ${url:-http://localhost:8787} — open it to create the admin account."
