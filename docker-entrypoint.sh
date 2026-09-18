#!/bin/sh
# Fix ownership of the scores volume at container startup, then drop to `node`.
#
# Why: `RUN chown` at build time is hidden at runtime when a (named or
# host-path, e.g. TrueNAS) volume is mounted over /app/data. Such volumes
# often arrive owned by root, so the `node` user (uid 1000) gets EACCES on
# /app/data/scores.json. Repairing here — while still root — fixes both
# pre-existing root-owned volumes and fresh host binds.
set -eu

DATA_DIR="$(dirname "${SCORES_FILE:-/app/data/scores.json}")"

echo "docker-entrypoint: uid=$(id -u) gid=$(id -g), SCORES_FILE=${SCORES_FILE:-/app/data/scores.json}"
ls -ldn "$DATA_DIR" 2>/dev/null || echo "docker-entrypoint: $DATA_DIR does not exist yet"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Repair ownership; don't fail the boot on read-only mounts.
  if chown -R node:node "$DATA_DIR" 2>/dev/null; then
    echo "docker-entrypoint: ownership of $DATA_DIR set to node:node"
  else
    echo "docker-entrypoint: WARNING cannot chown $DATA_DIR (read-only mount or root-squashed NFS?) — scores writes may fail with EACCES" >&2
  fi
  # shellcheck disable=SC2093
  exec su-exec node "$@"
fi

echo "docker-entrypoint: WARNING not running as root, cannot repair $DATA_DIR ownership — ensure it is writable by uid=$(id -u)" >&2
exec "$@"
