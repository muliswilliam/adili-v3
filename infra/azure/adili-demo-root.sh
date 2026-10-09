#!/bin/sh
# Privileged bits for the Azure demo. Installed once to /usr/local/sbin/adili-demo-root
# (root-owned, outside the rsync tree). adili may sudo only this path.
set -eu

ROOT="${ADILI_ROOT:-/opt/adili}"
PUBLIC_ENV="${ADILI_PUBLIC_ENV:-/etc/adili/public.env}"
CADDYFILE_SRC="${ROOT}/infra/azure/Caddyfile.cloudapp"
CADDYFILE_DST="${ADILI_CADDYFILE:-/etc/caddy/Caddyfile}"

cmd="${1:-}"
case "$cmd" in
  stop-apps)
    systemctl stop adili-apps 2>/dev/null || true
    ;;
  restart-apps)
    install -o root -g root -m 644 "$ROOT/infra/azure/adili-apps.service" \
      /etc/systemd/system/adili-apps.service
    systemctl daemon-reload
    systemctl enable adili-apps
    systemctl restart adili-apps
    ;;
  install-caddy)
    # shellcheck disable=SC1090
    . "$PUBLIC_ENV"
    if [ -z "${ADILI_LETSENCRYPT_EMAIL:-}" ] || [ -z "${ADILI_PUBLIC_BASE:-}" ]; then
      echo "Missing ADILI_LETSENCRYPT_EMAIL or ADILI_PUBLIC_BASE in $PUBLIC_ENV" >&2
      exit 1
    fi
    sed \
      -e "s|__EMAIL__|${ADILI_LETSENCRYPT_EMAIL}|g" \
      -e "s|__HOST__|${ADILI_PUBLIC_BASE}|g" \
      "$CADDYFILE_SRC" >"$CADDYFILE_DST"
    systemctl enable caddy
    systemctl reload caddy 2>/dev/null || systemctl restart caddy
    # The apps reach this host by its public name (Keycloak's issuer, the console, object
    # storage), and the NSG lets the VM reach its own public IP on 443 only: resolve the name
    # locally, where Caddy serves every port.
    if ! grep -qE "^127\.0\.0\.1[[:space:]]+${ADILI_PUBLIC_BASE}([[:space:]]|$)" /etc/hosts; then
      printf '127.0.0.1 %s\n' "$ADILI_PUBLIC_BASE" >>/etc/hosts
    fi
    ;;
  *)
    echo "usage: $0 stop-apps|restart-apps|install-caddy" >&2
    exit 1
    ;;
esac
