#!/bin/sh
# Installs Family Graph with Docker. Safe to run again: it keeps your settings and data.
#
#   ./install.sh                         on this computer
#   ./install.sh --domain family.example.com   on a server, with automatic HTTPS
set -eu
cd "$(dirname "$0")"

DOMAIN=""
PORT=3000
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "Docker is needed: https://docs.docker.com/get-docker/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose is needed: https://docs.docker.com/compose/install/"; exit 1; }

random() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

if [ ! -f .env ]; then
  if [ -n "$DOMAIN" ]; then URL="https://$DOMAIN"; BIND=127.0.0.1; else URL="http://localhost:$PORT"; BIND=127.0.0.1; fi
  umask 077
  cat > .env <<EOF
# Made by install.sh. Everything you can change is explained in .env.example.
BETTER_AUTH_URL=$URL
BETTER_AUTH_SECRET=$(random 48)
SETUP_TOKEN=$(random 24)
RECOVERY_TOKEN=$(random 32)
PORT=$PORT
BIND=$BIND
DOMAIN=$DOMAIN
EOF
  echo "Settings written to .env"
fi

value() { sed -n "s/^$1=//p" .env | head -n 1; }
DOMAIN=$(value DOMAIN)
PORT=$(value PORT)

if [ -n "$DOMAIN" ]; then COMPOSE="docker compose --profile https"; else COMPOSE="docker compose"; fi
echo "Building and starting. The first time takes a few minutes."
$COMPOSE up -d --build

printf "Waiting for the app"
i=0
until docker compose exec -T family node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { echo; echo "It did not start. See: docker compose logs family"; exit 1; }
  printf "."
  sleep 2
done
echo

URL=$(value BETTER_AUTH_URL)
if docker compose exec -T family node family.mjs doctor 2>/dev/null | grep -q '^Users:   0'; then
  echo
  echo "Ready. Open this address and create your family:"
  echo
  echo "  $URL/setup?code=$(value SETUP_TOKEN)"
else
  echo
  echo "Running at $URL"
fi
echo
echo "Connect an agent:  ./family token create --name my-agent --role editor"
echo "All commands:      ./family help"
