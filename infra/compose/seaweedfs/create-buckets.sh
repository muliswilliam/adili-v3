#!/bin/sh
# Buckets from ADR-002: uploads land in quarantine, move to clean after scanning;
# issued documents and audit archives are written by the platform; open-data holds the
# reporting service's open-data release files (spec 09b).
set -eu

# SEAWEEDFS_MASTER: CI runs this inside the SeaweedFS container itself.
master="${SEAWEEDFS_MASTER:-seaweedfs:9333}"
for bucket in quarantine clean issued audit-archive open-data; do
  echo "s3.bucket.create -name ${bucket}" | weed shell -master="${master}"
done
echo 'Buckets ready'
