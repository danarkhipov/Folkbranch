#!/bin/sh
# Installs Folkbranch. Safe to run again: it keeps your settings and data.
#
#   curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh
#   ... | sh -s -- --server                         on a server: starts with it, with HTTPS, no Docker and no domain needed
#   ... | sh -s -- --server --domain family.example.com    the same, at your own domain
#   ... | sh -s -- --domain family.example.com      on a server with Docker
#   ... | sh -s -- --docker                         on this computer, with Docker
#   ... | sh -s -- --port 8080 --dir ~/archive      another port or folder
set -eu

REPO=https://raw.githubusercontent.com/danarkhipov/folkbranch/main
RELEASES=https://github.com/danarkhipov/folkbranch/releases/latest/download
NODE_VERSION=24.22.2
NODE_MAJOR=${NODE_VERSION%%.*}
CADDY_VERSION=2.11.9
DOMAIN=""
PORT=3000
PORT_GIVEN=""
DIR=""
WANT=""
SERVER=""
NO_CADDY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; PORT_GIVEN=1; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --docker) WANT=docker; shift ;;
    --local) WANT=local; shift ;;
    --server) SERVER=1; shift ;;
    --no-caddy) NO_CADDY=1; shift ;;
    --no-open) export FOLKBRANCH_NO_OPEN=1; shift ;;
    -h|--help) sed -n '2,9p' "$0" 2>/dev/null; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
if [ -n "$DOMAIN" ] && [ -z "$SERVER" ]; then
  [ "$WANT" = local ] && { echo "--domain needs a server install or Docker, for its automatic HTTPS. Use --server instead of --local."; exit 1; }
  # A clean server has no Docker, and needs none.
  if [ "$WANT" != docker ] && ! command -v docker >/dev/null 2>&1; then SERVER=1; else WANT=docker; fi
fi
if [ -n "$NO_CADDY" ] && { [ -z "$SERVER" ] || [ -z "$DOMAIN" ]; }; then
  echo "--no-caddy is for a server behind your own proxy: add --server and --domain."
  exit 1
fi
SUDO=""
if [ -n "$SERVER" ]; then
  [ "$WANT" = docker ] && { echo "--server runs without Docker. Leave out one of them."; exit 1; }
  WANT=local
  if [ ! -d /run/systemd/system ]; then
    echo "--server needs systemd, to start the app with the server, and this system does not run it."
    echo "With Docker, use --domain family.example.com --docker instead."
    exit 1
  fi
  if [ "$(id -u)" != 0 ]; then
    command -v sudo >/dev/null 2>&1 || { echo "--server sets up system services: run this as root."; exit 1; }
    SUDO=sudo
  fi
fi

# Run from a clone or an install folder it works in place; run through curl it fetches what it needs.
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || echo .)
if [ -z "$DIR" ] && { [ -f "$HERE/.local" ] || { [ "$WANT" != local ] && [ -f "$HERE/docker-compose.yml" ]; }; }; then
  DIR=$HERE
fi
# Run again as root, a server install is found again. A first boot script has no HOME at all.
[ -z "$DIR" ] && [ "$(id -u)" = 0 ] && [ -f /opt/folkbranch/.server ] && DIR=/opt/folkbranch
[ -z "$DIR" ] && [ -n "$SERVER" ] && [ "$(id -u)" = 0 ] && DIR=/opt/folkbranch
DIR=${DIR:-$HOME/folkbranch}
if [ -f "$DIR/.server" ] && [ -z "$SERVER" ] && [ "$WANT" != docker ]; then
  SERVER=1
  [ "$(id -u)" = 0 ] || SUDO=sudo
fi

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
OLD_LIBC=""
platform() {
  case "$(uname -s)" in Darwin) OS=darwin ;; Linux) OS=linux ;; *) return 1 ;; esac
  case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64|amd64) ARCH=x64 ;; *) return 1 ;; esac
  # A terminal under Rosetta reports Intel on an Apple chip.
  if [ "$OS" = darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then ARCH=arm64; fi
  # The ready builds and Node's own are for the usual Linux, not for Alpine's.
  if [ -f /etc/alpine-release ] || { command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; }; then return 1; fi
  # The database driver in the ready builds needs this. Red Hat 8 and its kin are older.
  if [ "$OS" = linux ] && command -v getconf >/dev/null 2>&1; then
    libc=$(getconf GNU_LIBC_VERSION 2>/dev/null | cut -d' ' -f2 || true)
    case "$libc" in 2.*) if [ "${libc#2.}" -lt 29 ] 2>/dev/null; then OLD_LIBC=$libc; return 1; fi ;; esac
  fi
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
    elif [ -n "$OLD_LIBC" ]; then
      echo "This system is too old for the ready build: it has glibc $OLD_LIBC, and the app needs 2.29 or newer."
      echo "Ubuntu 22.04, Debian 12 and AlmaLinux 9 or newer will do. Or use Docker: https://docs.docker.com/get-docker/ and add --docker."
      exit 1
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
value() { sed -n "s/^$1=//p" .env | head -n 1; }
is_address() { case "$1" in *[!0-9.]*) return 1 ;; *) return 0 ;; esac; }

# With no domain of its own, a server still gets a real certificate: Let's Encrypt issues them for an address too.
server_name() {
  [ -n "$DOMAIN" ] && return 0
  [ -f .env ] && DOMAIN=$(value DOMAIN)
  [ -n "$DOMAIN" ] && return 0
  ip=${FOLKBRANCH_PUBLIC_IP:-$(curl -4 -fsS -m 15 https://checkip.amazonaws.com 2>/dev/null | tr -d ' \n' || true)}
  case "$ip" in
    ''|10.*|127.*|169.254.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*)
      echo "Could not find a public address for this server. Give it a name: --domain family.example.com"
      exit 1 ;;
  esac
  DOMAIN=$ip
}
if [ -n "$SERVER" ]; then
  umask 077
  server_name
  case "$DOMAIN" in *[!A-Za-z0-9.-]*) echo "This does not look like a domain: $DOMAIN"; exit 1 ;; esac
  if [ -f .env ] && [ "$(value BETTER_AUTH_URL)" != "https://$DOMAIN" ]; then
    # An address in a running app's settings changes only when it starts.
    [ -x ./folkbranch ] && ./folkbranch stop </dev/null >/dev/null 2>&1 || true
    sed -e "s|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=https://$DOMAIN|" -e "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env > .env.new && cat .env.new > .env && rm -f .env.new
  fi
fi

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
  mkdir -p runtime.new runtime
  tar -xf "$TMP/node" -C runtime.new --strip-components=2 "$base/bin/node"
  mv -f runtime.new/node runtime/node
  rm -rf runtime.new
}

# The web server that gets and renews the certificate. Kept here too, so removing the folder removes it.
fetch_caddy() {
  [ -x runtime/caddy ] && [ "$(runtime/caddy version </dev/null 2>/dev/null | cut -d' ' -f1)" = "v$CADDY_VERSION" ] && return 0
  dist=${FOLKBRANCH_CADDY_DIST:-https://github.com/caddyserver/caddy/releases/download}
  case "$ARCH" in x64) arch=amd64 ;; *) arch=$ARCH ;; esac
  base=caddy_${CADDY_VERSION}_linux_$arch.tar.gz
  echo "Getting Caddy $CADDY_VERSION for HTTPS, kept inside this folder."
  curl -fsSL "$dist/v$CADDY_VERSION/caddy_${CADDY_VERSION}_checksums.txt" -o "$TMP/caddy.sums"
  curl -fsSL "$dist/v$CADDY_VERSION/$base" -o "$TMP/caddy"
  [ "$(sha512sum "$TMP/caddy" | cut -d' ' -f1)" = "$(sed -n "s/  $base\$//p" "$TMP/caddy.sums")" ] || { echo "The Caddy download is damaged: its checksum does not match. Run this again."; exit 1; }
  rm -rf runtime.new
  mkdir -p runtime.new runtime
  tar -xzf "$TMP/caddy" -C runtime.new caddy
  mv -f runtime.new/caddy runtime/caddy
  rm -rf runtime.new
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q '^Status: active'; then
    $SUDO ufw allow 80/tcp >/dev/null && $SUDO ufw allow 443/tcp >/dev/null && echo "Opened ports 80 and 443 in ufw."
  elif command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state 2>/dev/null | grep -q running; then
    $SUDO firewall-cmd --permanent --add-service=http --add-service=https >/dev/null && $SUDO firewall-cmd --reload >/dev/null && echo "Opened ports 80 and 443 in firewalld."
  fi
}

# Whatever answers on these ports is another web server, and taking over from it is not for us to decide.
web_ports_free() {
  systemctl is-active --quiet folkbranch-caddy 2>/dev/null && return 0
  for p in 80 443; do
    rc=0
    curl -s -m 2 -o /dev/null "http://127.0.0.1:$p/" || rc=$?
    if [ "$rc" != 7 ]; then
      echo "Port $p is in use by another web server. Keep it, and point it at this app: add --no-caddy, then proxy $DOMAIN to 127.0.0.1:$(value PORT)."
      exit 1
    fi
  done
}

write_unit() {
  $SUDO tee "/etc/systemd/system/$1.service" >/dev/null
}

# The services run as their own user, so that nothing reachable from the internet runs as root.
prepare_server() {
  if [ -z "$SUDO" ] && [ "$(id -u)" = 0 ]; then
    id folkbranch >/dev/null 2>&1 || useradd --system --home-dir "$DIR" --shell /usr/sbin/nologin folkbranch
    owner=folkbranch
  else
    owner=$(id -un)
  fi
  mkdir -p data logs runtime
  if [ -z "$NO_CADDY" ] && [ ! -f .no-caddy ]; then
    web_ports_free
    fetch_caddy
    {
      echo '{'
      echo '	admin off'
      # A browser names no server when it opens an address, and behind a cloud's NAT the local address is not the public one.
      if is_address "$DOMAIN"; then echo "	default_sni $DOMAIN"; fi
      echo '}'
      echo "$DOMAIN {"
      if [ "${FOLKBRANCH_TLS:-}" = internal ]; then
        echo '	tls internal'
      elif is_address "$DOMAIN"; then
        # Certificates for an address last six days and renew by themselves.
        echo '	tls {'
        echo '		issuer acme {'
        echo '			profile shortlived'
        echo '		}'
        echo '	}'
      fi
      echo '	encode zstd gzip'
      echo '	header Strict-Transport-Security "max-age=31536000"'
      echo "	reverse_proxy 127.0.0.1:$(value PORT) {"
      echo '		header_up X-Real-IP {remote_host}'
      echo '	}'
      echo '}'
    } > Caddyfile
  else
    : > .no-caddy
  fi
  printf '%s' "$owner" > .server
  if [ -z "$SUDO" ]; then chown -Rh "$owner" "$DIR"; fi
  # On Red Hat systems SELinux keeps services from running programs out of an ordinary folder.
  if command -v selinuxenabled >/dev/null 2>&1 && selinuxenabled; then chcon -t bin_t folkbranch runtime/* 2>/dev/null || true; fi

  write_unit folkbranch <<UNIT
[Unit]
Description=Folkbranch
After=network.target

[Service]
User=$owner
WorkingDirectory=$DIR
Environment="HOME=$DIR"
ExecStart=/bin/sh -c 'exec ./folkbranch _run >> logs/folkbranch.log 2>&1'
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
  if [ -f Caddyfile ] && [ ! -f .no-caddy ]; then
    write_unit folkbranch-caddy <<UNIT
[Unit]
Description=Folkbranch HTTPS
After=network.target

[Service]
User=$owner
WorkingDirectory=$DIR
Environment="HOME=$DIR"
Environment="XDG_DATA_HOME=$DIR/runtime/caddy-data"
Environment="XDG_CONFIG_HOME=$DIR/runtime/caddy-data"
ExecStart=/bin/sh -c 'exec runtime/caddy run --config Caddyfile --adapter caddyfile >> logs/caddy.log 2>&1'
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
  fi
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --quiet folkbranch
  if [ ! -f .no-caddy ]; then
    open_firewall
    $SUDO systemctl enable --quiet folkbranch-caddy
    $SUDO systemctl restart folkbranch-caddy
  fi
}

# Proves the way a browser comes in, and the certificate with it.
wait_https() {
  [ -f .no-caddy ] && return 0
  k=""
  [ "${FOLKBRANCH_TLS:-}" = internal ] && k=-k
  printf "Getting a certificate"
  i=0
  until curl -fs -m 5 $k --connect-to "::127.0.0.1:443" -o /dev/null "https://$DOMAIN/api/health"; do
    i=$((i + 1))
    if [ "$i" -gt 30 ]; then
      echo
      echo "The app runs, but HTTPS is not ready for $DOMAIN. Usually one of these:"
      echo "  ports 80 and 443 are closed in your hosting panel's firewall;"
      is_address "$DOMAIN" && echo "  this address is not the server's own, so give it a name with --domain."
      is_address "$DOMAIN" || echo "  the domain does not point at this server yet."
      echo "It keeps trying by itself. What it says: $DIR/logs/caddy.log"
      return 0
    fi
    printf "."
    sleep 2
  done
  echo
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
    # A service does not see the Node of the person installing it, say from nvm.
    if [ ! -x runtime/node ] && { [ -n "$SERVER" ] || ! command -v node >/dev/null 2>&1 || ! node_fits "$(command -v node)" app.new; }; then fetch_node; fi
    [ -x ./folkbranch ] && ./folkbranch stop </dev/null >/dev/null 2>&1 || true
    if [ -d app ]; then mv app app.old; fi
    mv app.new app
    cp app/folkbranch ./folkbranch
    chmod +x ./folkbranch
    : > .local
  fi

  if [ -n "$SERVER" ]; then
    [ -x runtime/node ] || fetch_node
    prepare_server </dev/null
  fi

  # A failed update keeps the previous version next to it, in app.old.
  ./folkbranch start </dev/null || exit 1
  rm -rf app.old
  if [ -n "$SERVER" ]; then wait_https </dev/null; fi
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
if [ -n "$SERVER" ]; then
  is_address "$DOMAIN" && echo "For an address with a name: point a domain at this server and run this again with --domain family.example.com"
  echo "It starts with the server. A sign-in link:  cd $DIR && ./folkbranch open"
  echo "All commands:                               ./folkbranch help"
  exit 0
fi
echo "Connect Claude Code or Codex:  cd $DIR && ./folkbranch connect"
echo "Open it again later:           cd $DIR && ./folkbranch open"
echo "All commands:                  ./folkbranch help"
# Logged in to another machine, localhost is that machine: the browser here will not find it.
if [ -n "${SSH_CONNECTION:-}" ] && [ "$MODE" = local ]; then
  echo
  echo "This looks like a server. To open it from your own browser, run this again with --server."
fi
