#!/bin/sh
# Buckets from ADR-002: uploads land in quarantine, move to clean after scanning;
# issued documents and audit archives are written by the platform.
set -eu

for bucket in quarantine clean issued audit-archive; do
  echo "s3.bucket.create -name ${bucket}" | weed shell -master=seaweedfs:9333
done
echo 'Buckets ready'
