#!/bin/sh
# Restore each dump in a backup directory into a throwaway database, then drop it.
# Does not touch the live demo databases.
#
#   ./infra/azure/verify-restore.sh /home/adili/adili-backups/<stamp>
set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/infra/azure/demo-databases.sh"

SRC="${1:-}"
if [ -z "$SRC" ]; then
  SRC="$(find "$(adili_backup_root)" -mindepth 1 -maxdepth 1 -type d -name '????????T??????Z' 2>/dev/null | sort | tail -n 1)"
fi
if [ -z "$SRC" ] || [ ! -f "$SRC/SHA256SUMS" ]; then
  echo "Usage: $0 <backup-directory>" >&2
  exit 1
fi
COMPOSE_FILE="$ROOT/infra/compose/docker-compose.yml"
CREATED="$(mktemp)"

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

psql_exec() {
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"
}

cleanup() {
  if [ ! -f "$CREATED" ]; then
    return
  fi
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    psql_exec "DROP DATABASE IF EXISTS ${name} WITH (FORCE);" || true
  done <"$CREATED"
  rm -f "$CREATED"
}

trap cleanup EXIT INT TERM

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$SRC" && sha256sum -c SHA256SUMS)
else
  (cd "$SRC" && shasum -a 256 -c SHA256SUMS)
fi

: >"$CREATED"

for db in $(demo_databases); do
  check="rc_${db}"
  dump="$SRC/$db.dump"
  if [ ! -f "$dump" ]; then
    echo "Missing $dump" >&2
    exit 1
  fi
  echo "Restore check $db -> $check"
  printf '%s\n' "$check" >>"$CREATED"
  psql_exec "DROP DATABASE IF EXISTS ${check} WITH (FORCE);"
  psql_exec "CREATE DATABASE ${check};"
  compose exec -T postgres pg_restore -U postgres --exit-on-error --no-owner --dbname="$check" <"$dump"
  psql_exec "DROP DATABASE IF EXISTS ${check} WITH (FORCE);"
done

rm -f "$CREATED"
trap - EXIT INT TERM
echo "Restore check passed for $SRC"
