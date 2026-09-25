#!/bin/sh
set -eu

NAMESPACE="${DEFAULT_NAMESPACE:-default}"

until temporal operator cluster health --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1; do
  echo 'Waiting for Temporal server...'
  sleep 2
done

if temporal operator namespace describe -n "$NAMESPACE" --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1; then
  echo "Namespace ${NAMESPACE} already exists"
else
  temporal operator namespace create -n "$NAMESPACE" --retention 72h --address "$TEMPORAL_ADDRESS"
  echo "Namespace ${NAMESPACE} created"
fi
