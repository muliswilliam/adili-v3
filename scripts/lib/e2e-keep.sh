# The real end-to-end test accounts across a checkpoint restore (docs/demo-accounts.md). Sourced by
# scripts/demo-checkpoint.sh, which defines `compose`. A restore puts Keycloak's and the
# directory's databases back to the checkpoint, which would lose these accounts, or bring back the
# password and authenticator they had at capture. So before the databases are swapped,
# e2e_keep_save copies the accounts' rows out of the live ones, and after, e2e_keep_restore puts
# them into the restored ones:
#
# - Keycloak: every account of the realm at the e2e domain but a declarant's (staff,
#   law-enforcement, applicant), with its credentials (password, TOTP), attributes, required
#   actions, realm roles and groups. The restored database's copy of the same account (by id,
#   username or email) is replaced.
# - Directory: the law-enforcement officer's and the applicant's person, and the officer's record.
#   Kept only where the restored database has no such row already.
#
# A declarant is not kept: their account goes with their onboarding, roster record and
# obligations, which live in other services' databases. After a restore that predates their
# onboarding they onboard again (`pnpm e2e:accounts` puts their roster record back).
#
# The domain is E2E_EMAIL_DOMAIN (on the Azure host, its SMTP settings). Unset: nothing is kept.
# Rows are copied as JSON and inserted by column name, so a checkpoint from before a schema change
# still takes them. A failure to keep them never fails the restore: it says so, and the accounts
# are as the checkpoint has them.
# shellcheck shell=sh

E2E_KEYCLOAK_DB=keycloak
E2E_DIRECTORY_DB=adili_directory
E2E_REALM=adili

# The domain, when it is set and safe to put in SQL; else nothing.
e2e_keep_domain() {
  domain="$(printf '%s' "${E2E_EMAIL_DOMAIN:-}" | tr '[:upper:]' '[:lower:]')"
  case "$domain" in
    '' | *[!a-z0-9.-]* | .* | *. | *..*) return 0 ;;
  esac
  printf '%s\n' "$domain"
}

# The kept Keycloak accounts' ids, as a subquery.
e2e_keycloak_users() {
  cat <<SQL
SELECT u.id FROM user_entity u
WHERE u.realm_id = (SELECT id FROM realm WHERE name = '$E2E_REALM')
  AND lower(u.email) LIKE '%@$1'
  AND NOT EXISTS (
    SELECT 1 FROM user_role_mapping m JOIN keycloak_role r ON r.id = m.role_id
    WHERE m.user_id = u.id AND r.name = 'declarant' AND NOT r.client_role)
SQL
}

# The kept directory persons' ids, as a subquery.
e2e_directory_persons() {
  cat <<SQL
SELECT id FROM persons
WHERE lower(email) LIKE '%@$1' AND kind IN ('applicant', 'law-enforcement')
SQL
}

# Prints `<table> TAB <row as JSON>` lines (COPY text format) for each table and condition.
e2e_copy_out() {
  db="$1"
  shift
  while [ $# -ge 2 ]; do
    compose exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$db" -c \
      "COPY (SELECT '$1', row_to_json(t) FROM $1 t WHERE $2) TO STDOUT" || return 1
    shift 2
  done
}

# Copies the accounts' rows out of the live databases into directory $1. Run before the swap.
e2e_keep_save() {
  dir="$1"
  domain="$(e2e_keep_domain)"
  [ -n "$domain" ] || return 0
  users="id IN ($(e2e_keycloak_users "$domain"))"
  owned="user_id IN ($(e2e_keycloak_users "$domain"))"
  persons="$(e2e_directory_persons "$domain")"
  if ! (
    umask 077
    e2e_copy_out "$E2E_KEYCLOAK_DB" \
      user_entity "$users" \
      credential "$owned" \
      user_attribute "$owned" \
      user_required_action "$owned" \
      user_role_mapping "$owned" \
      user_group_membership "$owned" >"$dir/keycloak.copy"
    e2e_copy_out "$E2E_DIRECTORY_DB" \
      persons "id IN ($persons)" \
      law_enforcement_officers "person_id IN ($persons)" >"$dir/directory.copy"
  ); then
    echo "WARNING: could not copy the e2e accounts (@$domain); the restore leaves them as the checkpoint has them." >&2
    rm -f "$dir/keycloak.copy" "$dir/directory.copy"
    return 0
  fi
  log "E2E accounts copied: $(grep -c '^user_entity	' "$dir/keycloak.copy" || true) Keycloak accounts, $(grep -c '^persons	' "$dir/directory.copy" || true) directory persons"
}

# The SQL that loads the copied rows (from stdin, after it) into a temporary table `keep`.
e2e_load() {
  printf '%s\n' 'BEGIN;' 'CREATE TEMP TABLE keep (tbl text, j json) ON COMMIT DROP;' 'COPY keep FROM STDIN;'
  cat "$1"
  printf '%s\n' '\.'
}

# Inserts the kept rows of each table named, by column name, where `filter` (on the JSON `j`)
# holds, as SQL.
e2e_insert() {
  table="$1"
  filter="${2:-true}"
  suffix="${3:-}"
  printf "INSERT INTO %s SELECT (json_populate_record(NULL::%s, j)).* FROM keep WHERE tbl = '%s' AND %s %s;\n" \
    "$table" "$table" "$table" "$filter" "$suffix"
}

# Puts the rows e2e_keep_save copied into the restored databases. Run after the swap, while
# Keycloak is stopped.
e2e_keep_restore() {
  dir="$1"
  [ -s "$dir/keycloak.copy" ] || [ -s "$dir/directory.copy" ] || return 0
  if [ -s "$dir/keycloak.copy" ] && ! {
    e2e_load "$dir/keycloak.copy"
    cat <<'SQL'
-- The restored database's copies of the kept accounts, matched by id, username or email.
CREATE TEMP TABLE replaced ON COMMIT DROP AS
  SELECT u.id FROM user_entity u JOIN keep k ON k.tbl = 'user_entity'
  WHERE u.realm_id = k.j->>'realm_id'
    AND (u.id = k.j->>'id' OR u.username = k.j->>'username'
      OR u.email_constraint = k.j->>'email_constraint');
DO $$
DECLARE ref record;
BEGIN
  IF to_regclass('user_consent_client_scope') IS NOT NULL THEN
    DELETE FROM user_consent_client_scope WHERE user_consent_id IN
      (SELECT id FROM user_consent WHERE user_id IN (SELECT id FROM replaced));
  END IF;
  -- Every table that points at an account, whatever this Keycloak version has.
  FOR ref IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'user_entity'::regclass
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I IN (SELECT id FROM replaced)', ref.tbl, ref.col);
  END LOOP;
  DELETE FROM user_entity WHERE id IN (SELECT id FROM replaced);
END $$;
SQL
    e2e_insert user_entity "j->>'realm_id' IN (SELECT id FROM realm)"
    e2e_insert credential
    e2e_insert user_attribute
    e2e_insert user_required_action
    # Roles and groups of the realm as the checkpoint has it.
    e2e_insert user_role_mapping "j->>'role_id' IN (SELECT id FROM keycloak_role)"
    e2e_insert user_group_membership "j->>'group_id' IN (SELECT id FROM keycloak_group)"
    echo 'COMMIT;'
  } | compose exec -T -e PGOPTIONS='-c client_min_messages=warning' postgres \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$E2E_KEYCLOAK_DB" -f - >/dev/null; then
    echo "WARNING: could not put the e2e accounts back into Keycloak; they are as the checkpoint has them." >&2
  fi
  if [ -s "$dir/directory.copy" ] && ! {
    e2e_load "$dir/directory.copy"
    e2e_insert persons true 'ON CONFLICT DO NOTHING'
    e2e_insert law_enforcement_officers "(j->>'person_id')::uuid IN (SELECT id FROM persons)" \
      'ON CONFLICT DO NOTHING'
    echo 'COMMIT;'
  } | compose exec -T -e PGOPTIONS='-c client_min_messages=warning' postgres \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$E2E_DIRECTORY_DB" -f - >/dev/null; then
    echo "WARNING: could not put the e2e people back into the directory; they are as the checkpoint has them." >&2
  fi
  log 'E2E accounts kept'
}
