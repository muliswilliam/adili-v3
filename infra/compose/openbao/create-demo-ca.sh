#!/bin/sh
# Demo certification authority and signing keys for issued documents (ADR-010, spec 06).
#
# - PKI mount `pki-demo`: the "Adili Online Demo Root CA", key generated inside OpenBao.
# - Transit key `documents-pdf-signing` (RSA-3072, not exportable): signs the PAdES signatures;
#   its certificate, issued by the demo root, and the root go to KV `secret/documents/signing/demo`.
# - Transit key `documents-record-signing` (Ed25519, not exportable): signs verification records.
#
# Production replaces the demo root with a certificate from a licensed certification service
# provider. Safe to run repeatedly: an existing root, key or certificate is kept.
set -eu

PKI=pki-demo
PDF_KEY=documents-pdf-signing
RECORD_KEY=documents-record-signing
KV_PATH=secret/documents/signing/demo
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if bao secrets list -format=json | grep -q "\"${PKI}/\""; then
  echo "PKI engine ${PKI} already enabled"
else
  bao secrets enable -path="$PKI" pki >/dev/null
  bao secrets tune -max-lease-ttl=87600h "$PKI" >/dev/null
  echo "PKI engine ${PKI} enabled"
fi

if bao secrets list -format=json | grep -q '"transit/"'; then
  echo 'Transit engine already enabled'
else
  bao secrets enable transit >/dev/null
fi

# The root exists once the mount has a CA certificate.
if bao read -field=certificate "${PKI}/cert/ca" >"$work/root.pem" 2>/dev/null && [ -s "$work/root.pem" ]; then
  echo 'Demo root CA already present'
else
  bao write -field=certificate "${PKI}/root/generate/internal" \
    common_name='Adili Online Demo Root CA' organization='Adili Online (demo)' country=KE \
    key_type=rsa key_bits=3072 ttl=87600h >"$work/root.pem" 2>/dev/null
  echo 'Demo root CA generated'
fi

# Creating an existing key is a no-op in Transit.
bao write -f "transit/keys/${PDF_KEY}" type=rsa-3072 exportable=false >/dev/null
bao write -f "transit/keys/${RECORD_KEY}" type=ed25519 exportable=false >/dev/null
echo "Keys ${PDF_KEY} and ${RECORD_KEY} ready"

if bao kv get -field=certificate "$KV_PATH" >/dev/null 2>&1; then
  echo 'Document signing certificate already present'
  exit 0
fi

# Document signing (PAdES): digital signature and non-repudiation, EKU Document Signing.
bao write "${PKI}/roles/documents-signing" \
  allow_any_name=true enforce_hostnames=false allow_ip_sans=false allow_wildcard_certificates=false \
  server_flag=false client_flag=false code_signing_flag=false email_protection_flag=false \
  key_usage=DigitalSignature,ContentCommitment ext_key_usage_oids=1.3.6.1.4.1.311.10.3.12 \
  use_csr_common_name=false use_csr_sans=false organization='Adili Online (demo)' country=KE \
  key_type=rsa key_bits=3072 ttl=26280h max_ttl=26280h no_store=false >/dev/null

# The key signs its own request inside Transit, so the private key never leaves OpenBao.
bao write -f -field=csr "transit/keys/${PDF_KEY}/csr" >"$work/signing.csr"
bao write -field=certificate "${PKI}/sign/documents-signing" \
  csr=@"$work/signing.csr" common_name='Adili Online (demo)' exclude_cn_from_sans=true \
  >"$work/signing.pem"
bao kv put "$KV_PATH" certificate=@"$work/signing.pem" root=@"$work/root.pem" \
  transit_key="$PDF_KEY" >/dev/null
echo 'Document signing certificate issued'
