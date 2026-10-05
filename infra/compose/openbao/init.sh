#!/bin/sh
# Initialises the demo OpenBao once and gives it the fixed development root token every service
# and init job uses (`adili-dev-root-token`, as dev mode did). Safe to run repeatedly: an
# initialised server is only checked, never re-initialised, so keys and the demo CA are kept.
#
# The static seal (server/config.hcl) unseals the server on start; this job only waits for it.
set -eu

: "${BAO_ADDR:?}"
FIXED_TOKEN="${ADILI_BAO_ROOT_TOKEN:?}"

initialised() { bao status -format=json 2>/dev/null | grep -q '"initialized": true'; }
unsealed() { bao status -format=json 2>/dev/null | grep -q '"sealed": false'; }

wait_unsealed() {
  i=0
  until unsealed; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then
      echo 'OpenBao did not unseal within 60 s' >&2
      exit 1
    fi
    sleep 1
  done
}

if initialised; then
  echo 'OpenBao already initialised'
  wait_unsealed
else
  # One recovery share: the static seal does the unsealing, the recovery key is never needed in
  # the demo, and it is not kept.
  root=$(bao operator init -recovery-shares=1 -recovery-threshold=1 -format=json |
    sed -n 's/^ *"root_token": *"\([^"]*\)".*/\1/p')
  if [ -z "$root" ]; then
    echo 'OpenBao init returned no root token' >&2
    exit 1
  fi
  wait_unsealed
  BAO_TOKEN="$root" bao token create -id="$FIXED_TOKEN" -policy=root -orphan \
    -display-name=adili-dev-root >/dev/null
  BAO_TOKEN="$root" bao token revoke -self >/dev/null
  echo 'OpenBao initialised'
fi

export BAO_TOKEN="$FIXED_TOKEN"
if ! bao token lookup >/dev/null 2>&1; then
  echo 'The development root token is not valid on this OpenBao; run pnpm infra:reset' >&2
  exit 1
fi

# Dev mode mounted KV v2 at secret/; keep the same layout.
if bao secrets list -format=json | grep -q '"secret/"'; then
  echo 'KV engine secret/ already enabled'
else
  bao secrets enable -path=secret -version=2 kv >/dev/null
  echo 'KV engine secret/ enabled'
fi

# Transit holds the tenant and document signing keys; enabling it here, before openbao-keys and
# openbao-demo-ca run side by side, keeps them from racing to enable it.
if bao secrets list -format=json | grep -q '"transit/"'; then
  echo 'Transit engine already enabled'
else
  bao secrets enable transit >/dev/null
  echo 'Transit engine enabled'
fi
