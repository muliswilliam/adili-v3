#!/bin/sh
# Idempotent update of the Azure demo after a git push to main.
# Runs as adili. Privileged steps go through /usr/local/sbin/adili-demo-root.
# Does not terraform apply, re-seed, or re-issue certificates.
set -eu

ROOT="${ADILI_ROOT:-/opt/adili}"
PUBLIC_ENV="${ADILI_PUBLIC_ENV:-/etc/adili/public.env}"
COMPOSE="$ROOT/infra/compose/docker-compose.yml"
OVERLAY="$ROOT/infra/compose/docker-compose.azure.yml"
ROOT_HELPER="${ADILI_ROOT_HELPER:-/usr/local/sbin/adili-demo-root}"

if [ ! -f "$PUBLIC_ENV" ]; then
  echo "Missing $PUBLIC_ENV. Did cloud-init finish?" >&2
  exit 1
fi
if [ ! -f "$COMPOSE" ] || [ ! -f "$OVERLAY" ]; then
  echo "Missing compose files under $ROOT. Sync the repo first." >&2
  exit 1
fi
if [ ! -x "$ROOT_HELPER" ]; then
  echo "Missing $ROOT_HELPER. Install infra/azure/adili-demo-root.sh there as root." >&2
  exit 1
fi

HOME="${HOME:-/home/adili}"
export HOME
PATH="/usr/bin:/usr/local/bin:${HOME}/.local/bin:${HOME}/.local/share/pnpm:${PATH:-/usr/bin}"
export PATH
cd "$ROOT"

set -a
# shellcheck disable=SC1090
. "$PUBLIC_ENV"
set +a
export KC_HOSTNAME ADILI_CONSOLE_URL ADILI_PORTAL_URL

# shellcheck disable=SC1091
. "$ROOT/infra/azure/demo-vault.sh"
adili_prepare_demo_vault "$ROOT"

# The Keycloak image carries the login theme and the authenticators: rebuild it when they change,
# before the apps stop, so the build does not lengthen the downtime.
keycloak_inputs="$(cd "$ROOT" && find apps/keycloak-extension/src apps/keycloak-extension/pom.xml \
  apps/keycloak-theme/src packages/ui/src infra/docker/keycloak.Dockerfile -type f -exec sha256sum {} + | sort | sha256sum)"
keycloak_stamp="$HOME/.adili-keycloak-image"
if [ "$(cat "$keycloak_stamp" 2>/dev/null || true)" != "$keycloak_inputs" ]; then
  docker compose -f "$COMPOSE" -f "$OVERLAY" build keycloak
  printf '%s\n' "$keycloak_inputs" >"$keycloak_stamp"
fi

sudo -n "$ROOT_HELPER" stop-apps

echo "Compose stack"
docker compose -f "$COMPOSE" -f "$OVERLAY" up -d
if ! docker compose -f "$COMPOSE" -f "$OVERLAY" exec -T keycloak \
  bash -c 'test -r /opt/keycloak/vault/adili_demo-ticket-secret'; then
  echo "Keycloak cannot read its vault in $ADILI_KEYCLOAK_VAULT (owner must be its uid, 1000)." >&2
  exit 1
fi

python3 "$ROOT/infra/azure/patch-realm.py" "$ROOT/infra/compose/keycloak/adili-realm.json"

if [ -n "${ADILI_LETSENCRYPT_EMAIL:-}" ] && [ -n "${ADILI_PUBLIC_BASE:-}" ]; then
  sudo -n "$ROOT_HELPER" install-caddy
fi

echo "App dependencies and migrations"
pnpm bootstrap
# Keycloak's master admin gets this host's own password instead of the bootstrap admin_dev; the
# admin API is reachable on loopback only (Caddyfile.cloudapp).
KEYCLOAK_URL=http://127.0.0.1:18080 node infra/azure/keycloak-admin-password.mjs
# The realm import skips an existing realm: apply demo sign-in (#616) to the live one.
# The presentation deck at the portal's /deck/ embeds app views, so its origin may frame sign-in.
KEYCLOAK_URL=http://127.0.0.1:18080 KEYCLOAK_ADMIN_PASSWORD="$(cat "$ADILI_KEYCLOAK_ADMIN_PASSWORD_FILE")" \
  DEMO_FRAME_ANCESTORS="$ADILI_PORTAL_URL" node scripts/keycloak-demo-sign-in.mjs
./infra/azure/configure-app-env.sh
# The API reference Caddy serves at /api-docs/. A failed build leaves the last one up.
pnpm api:docs || echo "WARNING: API reference not rebuilt; /api-docs/ serves the previous build." >&2
pnpm db:migrate
if [ -f mocks/uv.lock ]; then
  (cd mocks && uv sync --locked)
fi
# Portal, console and verify run from their production builds (run-apps.sh, #371). They read
# their .env at start, so configure-app-env.sh changes need a restart, not a rebuild.
pnpm exec turbo run build --filter=@adili/portal --filter=@adili/console --filter=@adili/verify \
  --output-logs=errors-only

sudo -n "$ROOT_HELPER" restart-apps

echo "Nightly database backup"
"$ROOT/infra/azure/install-backup-cron.sh"

echo "Deployed $ROOT. Apps restart under adili-apps; demo data is left as-is."
