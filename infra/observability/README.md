# Observability

Services export traces and metrics through the OpenTelemetry collector (`infra/compose/otel/collector.yaml`, `localhost:4317`). Logs are structured JSON. A national ID or an amount in a log line fails `packages/api-kit/test/log-redaction.test.ts`.

## SigNoz dashboards

`signoz/*.json` imports in SigNoz (Dashboards, Import JSON).

| File | What it shows |
| --- | --- |
| `filings-and-queues-otlp-v1.json` | Filings per hour per Commission, outbox depth, dead-letter depth, Temporal workflow failures |
| `ai-and-adapters-otlp-v1.json` | AI tokens, blocked and failed jobs, adapter breakers, GenAI span attributes |

The collector logs telemetry until its exporter is pointed at a SigNoz collector. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to that collector (`http://<host>:4317`). The Temporal worker then exports `temporal_workflow_failed` to the same address.
