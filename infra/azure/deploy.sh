#!/bin/sh
# Idempotent update of the Azure demo after a git push to main.
# Does not terraform apply, does not re-seed, does not re-issue certificates.
# Run on the VM as root: sudo /opt/adili/infra/azure/deploy.sh
set -eu

ROOT="${ADILI_ROOT:-/opt/adili}"
PUBLIC_ENV="${ADILI_PUBLIC_ENV:-/etc/adili/public.env}"
COMPOSE="$ROOT/infra/compose/docker-compose.yml"
OVERLAY="$ROOT/infra/compose/docker-compose.azure.yml"
CADDYFILE_SRC="$ROOT/infra/azure/Caddyfile.cloudapp"
CADDYFILE_DST="${ADILI_CADDYFILE:-/etc/caddy/Caddyfile}"
SUDOERS_SRC="$ROOT/infra/azure/sudoers"
SUDOERS_DST="/etc/sudoers.d/adili-demo"
APP_USER="${ADILI_APP_USER:-adili}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi
if [ ! -f "$PUBLIC_ENV" ]; then
  echo "Missing $PUBLIC_ENV. Did cloud-init finish?" >&2
  exit 1
fi
if [ ! -f "$COMPOSE" ] || [ ! -f "$OVERLAY" ]; then
  echo "Missing compose files under $ROOT. Sync the repo first." >&2
  exit 1
fi

if [ -f "$SUDOERS_SRC" ]; then
  install -o root -g root -m 440 "$SUDOERS_SRC" "$SUDOERS_DST"
fi
install -o root -g root -m 644 "$ROOT/infra/azure/adili-apps.service" \
  /etc/systemd/system/adili-apps.service
systemctl daemon-reload
systemctl stop adili-apps 2>/dev/null || true

# shellcheck disable=SC1090
set -a
. "$PUBLIC_ENV"
set +a
export KC_HOSTNAME ADILI_CONSOLE_URL ADILI_PORTAL_URL

as_app() {
  runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" \
    PATH="/usr/bin:/usr/local/bin:/home/$APP_USER/.local/bin:/home/$APP_USER/.local/share/pnpm:$PATH" \
    KC_HOSTNAME="${KC_HOSTNAME:-}" \
    ADILI_CONSOLE_URL="${ADILI_CONSOLE_URL:-}" \
    ADILI_PORTAL_URL="${ADILI_PORTAL_URL:-}" \
    ADILI_VERIFY_URL="${ADILI_VERIFY_URL:-}" \
    "$@"
}

echo "Compose stack"
as_app docker compose -f "$COMPOSE" -f "$OVERLAY" up -d

if [ -f "$CADDYFILE_SRC" ] && [ -n "${ADILI_LETSENCRYPT_EMAIL:-}" ] && [ -n "${ADILI_PUBLIC_BASE:-}" ]; then
  sed \
    -e "s|__EMAIL__|${ADILI_LETSENCRYPT_EMAIL}|g" \
    -e "s|__HOST__|${ADILI_PUBLIC_BASE}|g" \
    "$CADDYFILE_SRC" >"$CADDYFILE_DST"
  systemctl enable caddy
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
fi

echo "App dependencies and migrations"
as_app sh -c "cd '$ROOT' && pnpm bootstrap && ./infra/azure/configure-app-env.sh && pnpm db:migrate"
if [ -f "$ROOT/mocks/uv.lock" ]; then
  as_app sh -c "cd '$ROOT/mocks' && uv sync --locked"
fi

systemctl enable adili-apps
systemctl restart adili-apps

echo "Deployed $ROOT. Apps restart under adili-apps; demo data is left as-is."
