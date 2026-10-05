#!/bin/sh
# Replace every demo database from a backup directory produced by backup-databases.sh.
# Stops nothing by itself. Stop adili-apps (and anything else using Postgres) first.
#
#   ADILI_RESTORE_CONFIRM=yes ./infra/azure/restore-databases.sh /home/adili/adili-backups/<stamp>
set -eu

if [ "${ADILI_RESTORE_CONFIRM:-}" != yes ]; then
  echo "Refusing to replace live databases. Re-run with ADILI_RESTORE_CONFIRM=yes." >&2
  exit 1
fi

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "$SRC/SHA256SUMS" ]; then
  echo "Usage: ADILI_RESTORE_CONFIRM=yes $0 <backup-directory>" >&2
  exit 1
fi

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/infra/azure/demo-databases.sh"
COMPOSE_FILE="$ROOT/infra/compose/docker-compose.yml"

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

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$SRC" && sha256sum -c SHA256SUMS)
else
  (cd "$SRC" && shasum -a 256 -c SHA256SUMS)
fi

for db in $(demo_databases); do
  owner="$(demo_database_owner "$db")"
  dump="$SRC/$db.dump"
  if [ ! -f "$dump" ]; then
    echo "Missing $dump" >&2
    exit 1
  fi
  echo "Restoring $db"
  psql_exec "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid();"
  psql_exec "DROP DATABASE IF EXISTS ${db} WITH (FORCE);"
  psql_exec "CREATE DATABASE ${db} OWNER ${owner};"
  psql_exec "REVOKE ALL ON DATABASE ${db} FROM PUBLIC;"
  compose exec -T postgres pg_restore -U postgres --exit-on-error --no-owner --role="$owner" --dbname="$db" <"$dump"
done

echo "Restore complete from $SRC"
