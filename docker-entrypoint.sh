#!/bin/sh
# Hosting platforms mount a new volume as root, but the app must not run as root.
# So the container starts as root only to hand the data over, then drops to the node user for good.
set -e
if [ "$(id -u)" = 0 ]; then
  dir="${RAILWAY_VOLUME_MOUNT_PATH:-${DATA_DIR:-/data}}"
  mkdir -p "$dir"
  find "$dir" \! -user node -exec chown node:node {} +
  HOME=/home/node exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
