#!/bin/sh
# Creates one database and one owning role per service (ADR-013: no shared databases).
# Safe to run on every `pnpm infra:up`: existing roles and databases are left alone.
set -eu

create_db() {
  role="$1"
  db="$2"
  password="$3"
  echo "Ensuring role ${role} and database ${db}"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
SELECT 'CREATE ROLE ${role} WITH LOGIN PASSWORD ''${password}'';'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}')\\gexec
SELECT 'CREATE DATABASE ${db} OWNER ${role};'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')\\gexec
REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
SQL
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
ALTER SCHEMA public OWNER TO ${role};
SQL
}

for svc in directory declarations review access reporting documents verification ai_gateway integration_gateway notifications audit; do
  create_db "adili_${svc}" "adili_${svc}" "adili_${svc}_dev"
done

create_db keycloak keycloak keycloak_dev
create_db mocks mocks mocks_dev
# pytest-django creates and drops its own test database.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c 'ALTER ROLE mocks CREATEDB;'
# Scratch database for integration tests of shared packages.
create_db adili_test adili_test adili_test_dev

# Temporal's schema tool manages its own two databases.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
SELECT 'CREATE ROLE temporal WITH LOGIN CREATEDB PASSWORD ''temporal_dev'';'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'temporal')\\gexec
SELECT 'CREATE DATABASE temporal OWNER temporal;'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal')\\gexec
SELECT 'CREATE DATABASE temporal_visibility OWNER temporal;'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal_visibility')\\gexec
SQL

# Organisation hierarchy uses ltree (ADR-006).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname adili_directory -c 'CREATE EXTENSION IF NOT EXISTS ltree;'
