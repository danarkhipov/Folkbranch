#!/bin/sh
# Installs Folkbranch with Docker. Safe to run again: it keeps your settings and data.
#
#   curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh
#   ... | sh -s -- --domain family.example.com      on a server, with automatic HTTPS
#   ... | sh -s -- --port 8080 --dir ~/archive       another port or folder
set -eu

REPO=https://raw.githubusercontent.com/danarkhipov/folkbranch/main
DOMAIN=""
PORT=3000
DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,6p' "$0" 2>/dev/null; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "Docker is needed: https://docs.docker.com/get-docker/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose is needed: https://docs.docker.com/compose/install/"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Start it and run this again."; exit 1; }

# Run from a clone it works in place; run through curl it fetches the few files it needs.
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || echo .)
if [ -z "$DIR" ] && [ -f "$HERE/docker-compose.yml" ]; then
  DIR=$HERE
else
  DIR=${DIR:-$HOME/folkbranch}
  mkdir -p "$DIR"
  for f in docker-compose.yml Caddyfile folkbranch; do
    [ -f "$DIR/$f" ] || curl -fsSL "$REPO/$f" -o "$DIR/$f"
  done
  chmod +x "$DIR/folkbranch"
fi
cd "$DIR"

random() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

if [ ! -f .env ]; then
  if [ -n "$DOMAIN" ]; then URL="https://$DOMAIN"; else URL="http://localhost:$PORT"; fi
  umask 077
  cat > .env <<EOF
# Made by install.sh. Everything you can change: https://github.com/danarkhipov/folkbranch/blob/main/.env.example
BETTER_AUTH_URL=$URL
BETTER_AUTH_SECRET=$(random 48)
SETUP_TOKEN=$(random 24)
RECOVERY_TOKEN=$(random 32)
PORT=$PORT
BIND=127.0.0.1
DOMAIN=$DOMAIN
EOF
  echo "Settings written to $DIR/.env"
fi

value() { sed -n "s/^$1=//p" .env | head -n 1; }
DOMAIN=$(value DOMAIN)
PORT=$(value PORT)
IMAGE=${FOLKBRANCH_IMAGE:-ghcr.io/danarkhipov/folkbranch:latest}
export FOLKBRANCH_IMAGE="$IMAGE"

if [ -n "$DOMAIN" ]; then COMPOSE="docker compose --profile https"; else COMPOSE="docker compose"; fi
echo "Getting the app. The first time takes a minute."
# A ready image needs no build and no build machine. A clone can still build its own, say for an unreleased change.
if docker compose pull -q folkbranch 2>/dev/null || docker image inspect "$IMAGE" >/dev/null 2>&1; then
  $COMPOSE up -d --no-build
elif [ -f Dockerfile ]; then
  echo "No ready image: building here, which takes a few minutes and about 2 GB of memory."
  $COMPOSE up -d --build
else
  echo "Could not download $IMAGE. Check the connection and run this again."
  exit 1
fi

printf "Waiting for the app"
i=0
until docker compose exec -T folkbranch node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { echo; echo "It did not start. See: cd $DIR && docker compose logs folkbranch"; exit 1; }
  printf "."
  sleep 2
done
echo

URL=$(value BETTER_AUTH_URL)
if docker compose exec -T folkbranch node folkbranch.mjs doctor 2>/dev/null | grep -q '^Users:   0'; then
  echo
  echo "Ready. Open this address and create your family:"
  echo
  echo "  $URL/setup?code=$(value SETUP_TOKEN)"
else
  echo
  echo "Running at $URL"
fi
echo
echo "Connect Claude Code or Codex:  cd $DIR && ./folkbranch connect"
echo "All commands:                  ./folkbranch help"
