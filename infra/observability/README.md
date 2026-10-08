# Observability

Services export traces and metrics through the OpenTelemetry collector (`infra/compose/otel/collector.yaml`, `localhost:4317`). Logs are structured JSON. A national ID or an amount in a log line fails `packages/api-kit/test/log-redaction.test.ts`.

## SigNoz dashboards

`signoz/*.json` imports in SigNoz (Dashboards, Import JSON).

| File | What it shows |
| --- | --- |
| `filings-and-queues-otlp-v1.json` | Filings per hour per Commission, outbox depth, dead-letter depth, Temporal workflow failures |
| `ai-and-adapters-otlp-v1.json` | AI tokens, blocked and failed jobs, adapter breakers, GenAI span attributes |

`pnpm dev` loads the same OpenTelemetry register as `start`, so traces and metrics leave the process when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (`http://localhost:4317`). Locally the collector only logs them. On the Azure demo it forwards to SigNoz at `https://<demo-host>/signoz`. Deploy imports the JSON files above, and the alerts in `signoz/alerts/`: error spans, and ERROR or FATAL logs, each grouped by service. They show on the Alerts page when a service records one in the last 5 minutes. SigNoz requires a notification channel to store a rule, so deploy also creates a webhook named Adili alerts that stays on the VM and does not send mail. App logs are the `adili-apps` journal; each line is tagged with the service in the Turbo prefix (`@adili/directory`), which is what the SigNoz service filter reads.
