#!/bin/sh
# Creates one database and one owning role per service (ADR-013: no shared databases).
# Runs once, on first start of an empty data volume.
set -eu

create_db() {
  role="$1"
  db="$2"
  password="$3"
  echo "Creating role ${role} and database ${db}"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE ${role} WITH LOGIN PASSWORD '${password}';
CREATE DATABASE ${db} OWNER ${role};
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
CREATE ROLE temporal WITH LOGIN CREATEDB PASSWORD 'temporal_dev';
CREATE DATABASE temporal OWNER temporal;
CREATE DATABASE temporal_visibility OWNER temporal;
SQL

# Organisation hierarchy uses ltree (ADR-006).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname adili_directory -c 'CREATE EXTENSION IF NOT EXISTS ltree;'
