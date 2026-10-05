#!/bin/sh
# Dump every demo database from the Compose Postgres.
# Writes a timestamped directory of custom-format dumps outside the repo tree,
# so the Azure rsync --delete cannot remove them.
#
#   ./infra/azure/backup-databases.sh
#   ADILI_BACKUP_ROOT=/home/adili/adili-backups ./infra/azure/backup-databases.sh
#
# Keeps 7 days of stamp directories under the backup root.
set -eu
umask 077

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/infra/azure/demo-databases.sh"

BACKUP_ROOT="$(adili_backup_root)"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
COMPOSE_FILE="$ROOT/infra/compose/docker-compose.yml"
KEEP_DAYS=7

compose() {
  if [ -n "${COMPOSE_BIN:-}" ]; then
    # shellcheck disable=SC2086
    $COMPOSE_BIN -f "$COMPOSE_FILE" "$@"
  elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
    podman compose -f "$COMPOSE_FILE" "$@"
  else
    echo "Need Docker Compose or Podman Compose on PATH" >&2
    exit 1
  fi
}

mkdir -p "$DEST"
trap 'rm -rf "$DEST"' EXIT INT TERM
echo "Backing up to $DEST"

for db in $(demo_databases); do
  partial="$DEST/$db.dump.partial"
  echo "Dumping $db"
  compose exec -T postgres pg_dump -U postgres -Fc --dbname="$db" >"$partial"
  mv "$partial" "$DEST/$db.dump"
done

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$DEST" && sha256sum ./*.dump >SHA256SUMS)
else
  (cd "$DEST" && shasum -a 256 ./*.dump >SHA256SUMS)
fi

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '????????T??????Z' -mtime +"$KEEP_DAYS" -exec rm -rf {} +
trap - EXIT INT TERM
echo "Backup complete: $DEST"
