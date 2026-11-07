#!/bin/sh
# Installs Folkbranch. Safe to run again: it keeps your settings and data.
#
#   curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh
#   ... | sh -s -- --domain family.example.com      on a server, with Docker and automatic HTTPS
#   ... | sh -s -- --docker                         on this computer, with Docker
#   ... | sh -s -- --port 8080 --dir ~/archive      another port or folder
set -eu

REPO=https://raw.githubusercontent.com/danarkhipov/folkbranch/main
RELEASES=https://github.com/danarkhipov/folkbranch/releases/latest/download
NODE_VERSION=24.22.2
NODE_MAJOR=${NODE_VERSION%%.*}
DOMAIN=""
PORT=3000
PORT_GIVEN=""
DIR=""
WANT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; PORT_GIVEN=1; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --docker) WANT=docker; shift ;;
    --local) WANT=local; shift ;;
    --no-open) export FOLKBRANCH_NO_OPEN=1; shift ;;
    -h|--help) sed -n '2,7p' "$0" 2>/dev/null; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
if [ -n "$DOMAIN" ]; then
  [ "$WANT" = local ] && { echo "--domain needs Docker, for its automatic HTTPS. Leave out --local."; exit 1; }
  WANT=docker
fi

# Run from a clone or an install folder it works in place; run through curl it fetches what it needs.
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || echo .)
if [ -z "$DIR" ] && { [ -f "$HERE/.local" ] || { [ "$WANT" != local ] && [ -f "$HERE/docker-compose.yml" ]; }; }; then
  DIR=$HERE
fi
DIR=${DIR:-$HOME/folkbranch}

# What a folder already holds decides how it updates: a Docker install keeps its data in a Docker volume.
HAVE=""
if [ -f "$DIR/.local" ]; then HAVE=local; elif [ -f "$DIR/docker-compose.yml" ]; then HAVE=docker; fi
if [ -n "$WANT" ] && [ -n "$HAVE" ] && [ "$WANT" != "$HAVE" ]; then
  echo "$DIR already holds an install of the other kind ($HAVE), and this would not carry its data over."
  echo "To move: download a full copy under Settings, install into another folder with --dir, and restore it there."
  exit 1
fi
MODE=${WANT:-${HAVE:-local}}

OS=""
ARCH=""
EXT=gz
platform() {
  case "$(uname -s)" in Darwin) OS=darwin ;; Linux) OS=linux ;; *) return 1 ;; esac
  case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; *) return 1 ;; esac
  # A terminal under Rosetta reports Intel on an Apple chip.
  if [ "$OS" = darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then ARCH=arm64; fi
  # The ready builds and Node's own are for the usual Linux, not for Alpine's.
  if [ -f /etc/alpine-release ] || { command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; }; then return 1; fi
  if [ "$OS" = darwin ] || command -v xz >/dev/null 2>&1; then EXT=xz; fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

TMP=$(mktemp -d "${TMPDIR:-/tmp}/folkbranch.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

BUNDLE_SUM=""
fetch_bundle() {
  url=${FOLKBRANCH_BUNDLE:-$RELEASES/folkbranch-$OS-$ARCH.tar.$EXT}
  echo "Getting the app."
  curl -fsSL "$url" -o "$TMP/bundle" && curl -fsSL "$url.sha256" -o "$TMP/bundle.sha256" || return 1
  BUNDLE_SUM=$(cut -d' ' -f1 < "$TMP/bundle.sha256")
  [ "$(sha256 "$TMP/bundle")" = "$BUNDLE_SUM" ] || { echo "The download is damaged: its checksum does not match. Run this again."; exit 1; }
}

# Without Docker, on a computer we have no ready build for or while a release is still being built, Docker can step in.
if [ "$MODE" = local ]; then
  if ! platform || ! fetch_bundle; then
    if [ -z "$WANT$HAVE" ] && command -v docker >/dev/null 2>&1; then
      echo "No ready build for this computer, so using Docker."
      MODE=docker
    else
      echo "No ready build for this computer ($(uname -s) $(uname -m)), or it is still being published. Try again in a few minutes."
      echo "Or use Docker: https://docs.docker.com/get-docker/ and add --docker."
      exit 1
    fi
  fi
fi

if [ "$MODE" = docker ]; then
  command -v docker >/dev/null 2>&1 || { echo "Docker is needed: https://docs.docker.com/get-docker/"; exit 1; }
  docker compose version >/dev/null 2>&1 || { echo "Docker Compose is needed: https://docs.docker.com/compose/install/"; exit 1; }
  docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Start it and run this again."; exit 1; }
  if [ "$DIR" != "$HERE" ] || [ ! -f "$HERE/docker-compose.yml" ]; then
    mkdir -p "$DIR"
    for f in docker-compose.yml Caddyfile folkbranch; do
      [ -f "$DIR/$f" ] || curl -fsSL "$REPO/$f" -o "$DIR/$f"
    done
    chmod +x "$DIR/folkbranch"
  fi
else
  mkdir -p "$DIR"
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

# Node for this install: a copy kept here if it has one, the computer's own if that can run the app, else a copy.
node_fits() {
  (cd "$2" && "$1" -e "if (+process.versions.node.split('.')[0] < $NODE_MAJOR) process.exit(1); require('better-sqlite3'); require('sharp')") </dev/null >/dev/null 2>&1
}

fetch_node() {
  dist=${FOLKBRANCH_NODE_DIST:-https://nodejs.org/dist}
  base=node-v$NODE_VERSION-$OS-$ARCH
  echo "Getting Node $NODE_VERSION, kept inside this folder."
  curl -fsSL "$dist/v$NODE_VERSION/SHASUMS256.txt" -o "$TMP/node.sums"
  curl -fsSL "$dist/v$NODE_VERSION/$base.tar.$EXT" -o "$TMP/node"
  [ "$(sha256 "$TMP/node")" = "$(sed -n "s/  $base\.tar\.$EXT\$//p" "$TMP/node.sums")" ] || { echo "The Node download is damaged: its checksum does not match. Run this again."; exit 1; }
  rm -rf runtime.new
  mkdir -p runtime.new
  tar -xf "$TMP/node" -C runtime.new --strip-components=2 "$base/bin/node"
  rm -rf runtime
  mv runtime.new runtime
}

install_local() {
  # Stopping first matters: the running app must not have its files swapped under it.
  if [ -n "$PORT_GIVEN" ] && [ "$(value PORT)" != "$PORT" ]; then
    [ -x ./folkbranch ] && ./folkbranch stop </dev/null >/dev/null 2>&1 || true
    sed "s|^PORT=.*|PORT=$PORT|" .env > .env.new && mv .env.new .env
    case "$(value BETTER_AUTH_URL)" in
      http://localhost:*) sed "s|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=http://localhost:$PORT|" .env > .env.new && mv .env.new .env ;;
    esac
  fi

  if [ "$(cat app/.sha256 2>/dev/null || true)" != "$BUNDLE_SUM" ]; then
    rm -rf app.new app.old
    mkdir app.new
    tar -xf "$TMP/bundle" -C app.new --strip-components=1
    printf '%s' "$BUNDLE_SUM" > app.new/.sha256
    if [ -x runtime/node ] && [ "$(runtime/node -v </dev/null 2>/dev/null || true)" != "v$NODE_VERSION" ]; then fetch_node; fi
    if [ ! -x runtime/node ] && { ! command -v node >/dev/null 2>&1 || ! node_fits "$(command -v node)" app.new; }; then fetch_node; fi
    [ -x ./folkbranch ] && ./folkbranch stop </dev/null >/dev/null 2>&1 || true
    if [ -d app ]; then mv app app.old; fi
    mv app.new app
    cp app/folkbranch ./folkbranch
    chmod +x ./folkbranch
    : > .local
  fi

  # A failed update keeps the previous version next to it, in app.old.
  ./folkbranch start </dev/null || exit 1
  rm -rf app.old
}

if [ "$MODE" = local ]; then
  # Family data stays private to this user, like .env.
  umask 077
  install_local
else
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
  # Through curl this script arrives on stdin, so exec must not read it: </dev/null keeps the rest of the script.
  until docker compose exec -T folkbranch node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" </dev/null >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -gt 60 ] && { echo; echo "It did not start. See: cd $DIR && docker compose logs folkbranch"; exit 1; }
    printf "."
    sleep 2
  done
  echo
fi

URL=$(value BETTER_AUTH_URL)
if [ "$MODE" = local ]; then
  USERS=$(./folkbranch doctor </dev/null 2>/dev/null || true)
else
  USERS=$(docker compose exec -T folkbranch node folkbranch.mjs doctor </dev/null 2>/dev/null || true)
fi
if printf '%s\n' "$USERS" | grep -q '^Users:   0'; then
  echo
  echo "Ready. Open this address and create your family:"
  echo
  echo "  $URL/setup?code=$(value SETUP_TOKEN)"
  # The first time, the browser opens by itself. Docker keeps to printing: it is mostly for servers.
  if [ "$MODE" = local ]; then ./folkbranch _browse "$URL/setup?code=$(value SETUP_TOKEN)" </dev/null || true; fi
else
  echo
  echo "Running at $URL"
fi
echo
echo "Connect Claude Code or Codex:  cd $DIR && ./folkbranch connect"
echo "Open it again later:           cd $DIR && ./folkbranch open"
echo "All commands:                  ./folkbranch help"
