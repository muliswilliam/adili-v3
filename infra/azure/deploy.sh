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

# shellcheck disable=SC1090
set -a
. "$PUBLIC_ENV"
set +a
export KC_HOSTNAME ADILI_CONSOLE_URL ADILI_PORTAL_URL

sudo -n "$ROOT_HELPER" stop-apps

echo "Compose stack"
docker compose -f "$COMPOSE" -f "$OVERLAY" up -d

python3 "$ROOT/infra/azure/patch-realm.py" "$ROOT/infra/compose/keycloak/adili-realm.json"

if [ -n "${ADILI_LETSENCRYPT_EMAIL:-}" ] && [ -n "${ADILI_PUBLIC_BASE:-}" ]; then
  sudo -n "$ROOT_HELPER" install-caddy
fi

echo "App dependencies and migrations"
pnpm bootstrap
./infra/azure/configure-app-env.sh
pnpm db:migrate
if [ -f mocks/uv.lock ]; then
  (cd mocks && uv sync --locked)
fi

sudo -n "$ROOT_HELPER" restart-apps

echo "Nightly database backup"
"$ROOT/infra/azure/install-backup-cron.sh"

echo "Deployed $ROOT. Apps restart under adili-apps; demo data is left as-is."
