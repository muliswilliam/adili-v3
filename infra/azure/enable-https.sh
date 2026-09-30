#!/bin/sh
# Terminate TLS with Caddy + Let's Encrypt on the Azure cloudapp hostname (no custom domain).
# Apps keep listening on loopback; Caddy is the public HTTP/HTTPS edge.
set -eu

ROOT="${ADILI_ROOT:-/opt/adili}"
PUBLIC_ENV="${ADILI_PUBLIC_ENV:-/etc/adili/public.env}"
CADDYFILE_SRC="${ROOT}/infra/azure/Caddyfile.cloudapp"
CADDYFILE_DST="${ADILI_CADDYFILE:-/etc/caddy/Caddyfile}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi
install -o root -g root -m 755 "$ROOT/infra/azure/adili-demo-root.sh" /usr/local/sbin/adili-demo-root
install -o root -g root -m 440 "$ROOT/infra/azure/sudoers" /etc/sudoers.d/adili-demo
systemctl stop adili-apps 2>/dev/null || true
if [ ! -f "$PUBLIC_ENV" ]; then
  echo "Missing $PUBLIC_ENV" >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$PUBLIC_ENV"

host="${ADILI_PUBLIC_BASE}"
email="${ADILI_LETSENCRYPT_EMAIL:-}"
if [ -z "$email" ]; then
  echo "Set ADILI_LETSENCRYPT_EMAIL in $PUBLIC_ENV (Let's Encrypt account)." >&2
  exit 1
fi

portal_url="https://${host}"
console_url="https://${host}:3020"
verify_url="https://${host}:3030"
keycloak_url="https://${host}:8080"

tmp_env="$(mktemp)"
sed \
  -e "s|^ADILI_PORTAL_URL=.*|ADILI_PORTAL_URL=${portal_url}|" \
  -e "s|^ADILI_CONSOLE_URL=.*|ADILI_CONSOLE_URL=${console_url}|" \
  -e "s|^ADILI_VERIFY_URL=.*|ADILI_VERIFY_URL=${verify_url}|" \
  -e "s|^KC_HOSTNAME=.*|KC_HOSTNAME=${keycloak_url}|" \
  "$PUBLIC_ENV" >"$tmp_env"
if ! grep -q '^ADILI_LETSENCRYPT_EMAIL=' "$tmp_env"; then
  echo "ADILI_LETSENCRYPT_EMAIL=${email}" >>"$tmp_env"
fi
if grep -q '^ADILI_TLS=' "$tmp_env"; then
  sed -i 's|^ADILI_TLS=.*|ADILI_TLS=1|' "$tmp_env"
else
  echo "ADILI_TLS=1" >>"$tmp_env"
fi
install -m 644 "$tmp_env" "$PUBLIC_ENV"
rm -f "$tmp_env"

# shellcheck disable=SC1090
. "$PUBLIC_ENV"
export KC_HOSTNAME ADILI_CONSOLE_URL ADILI_PORTAL_URL

sed \
  -e "s|__EMAIL__|${email}|g" \
  -e "s|__HOST__|${host}|g" \
  "$CADDYFILE_SRC" >"$CADDYFILE_DST"

python3 "$ROOT/infra/azure/patch-realm.py" "$ROOT/infra/compose/keycloak/adili-realm.json"

COMPOSE="$ROOT/infra/compose/docker-compose.yml"
OVERLAY="$ROOT/infra/compose/docker-compose.azure.yml"
docker compose -f "$COMPOSE" -f "$OVERLAY" up -d --force-recreate --no-deps keycloak

echo "Waiting for Keycloak..."
for _ in $(seq 1 36); do
  if docker exec adili-keycloak-1 /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://127.0.0.1:8080 --realm master --user admin --password admin_dev >/dev/null 2>&1; then
    break
  fi
  sleep 5
done
docker exec adili-keycloak-1 /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://127.0.0.1:8080 --realm master --user admin --password admin_dev
docker exec adili-keycloak-1 /opt/keycloak/bin/kcadm.sh update realms/adili -s sslRequired=none
portal_id="$(docker exec adili-keycloak-1 /opt/keycloak/bin/kcadm.sh get clients -r adili -q clientId=portal --fields id --format csv --noquotes | tail -n 1)"
console_id="$(docker exec adili-keycloak-1 /opt/keycloak/bin/kcadm.sh get clients -r adili -q clientId=console --fields id --format csv --noquotes | tail -n 1)"
docker exec adili-keycloak-1 /opt/keycloak/bin/kcadm.sh update "clients/${portal_id}" -r adili \
  -s "redirectUris=[\"${ADILI_PORTAL_URL}/*\"]" \
  -s "webOrigins=[\"${ADILI_PORTAL_URL}\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=${ADILI_PORTAL_URL}/*"
docker exec adili-keycloak-1 /opt/keycloak/bin/kcadm.sh update "clients/${console_id}" -r adili \
  -s "redirectUris=[\"${ADILI_CONSOLE_URL}/*\"]" \
  -s "webOrigins=[\"${ADILI_CONSOLE_URL}\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=${ADILI_CONSOLE_URL}/*"

systemctl enable caddy
systemctl restart caddy

echo "Caddy HTTPS: portal=${portal_url} console=${console_url} keycloak=${keycloak_url}"
echo "Then as adili: ${ROOT}/infra/azure/configure-app-env.sh && sudo systemctl restart adili-apps"
