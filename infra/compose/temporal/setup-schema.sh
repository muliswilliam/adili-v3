#!/bin/sh
# Idempotent Temporal schema setup for PostgreSQL (databases are created by postgres/init-databases.sh).
set -eu

: "${POSTGRES_SEEDS:?POSTGRES_SEEDS is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${SQL_PASSWORD:?SQL_PASSWORD is required}"
PORT="${DB_PORT:-5432}"

tool() {
  temporal-sql-tool --plugin postgres12 --ep "$POSTGRES_SEEDS" -u "$POSTGRES_USER" -p "$PORT" "$@"
}

for db in temporal temporal_visibility; do
  schema_dir=/etc/temporal/schema/postgresql/v12/temporal/versioned
  [ "$db" = temporal_visibility ] && schema_dir=/etc/temporal/schema/postgresql/v12/visibility/versioned
  # setup-schema fails once the version table exists; update-schema below is the real check.
  tool --db "$db" setup-schema -v 0.0 2>/dev/null || echo "$db: base schema already present"
  tool --db "$db" update-schema -d "$schema_dir"
done

echo 'Temporal schema is up to date'
