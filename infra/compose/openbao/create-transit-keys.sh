#!/bin/sh
# Transit engine and tenant keys for the field cipher (spec 05): services also create
# tenant-<slug> on first use, this seeds the demo Commissions. Safe to run repeatedly.
set -eu

if bao secrets list -format=json | grep -q '"transit/"'; then
  echo 'Transit engine already enabled'
else
  bao secrets enable transit
fi

for tenant in psc tsc eacc; do
  # Creating an existing key is a no-op in Transit.
  bao write -f "transit/keys/tenant-${tenant}" type=aes256-gcm96 derived=false exportable=false >/dev/null
  echo "Key tenant-${tenant} ready"
done
