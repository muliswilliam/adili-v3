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

# Describing a namespace reads the database; workers and clients resolve it through the server's
# namespace cache, which can lag a fresh namespace. Done means a task queue call in it answers.
until temporal task-queue describe --task-queue namespace-ready -n "$NAMESPACE" --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1; do
  echo "Waiting for namespace ${NAMESPACE} to be served..."
  sleep 1
done
echo "Namespace ${NAMESPACE} is served"
