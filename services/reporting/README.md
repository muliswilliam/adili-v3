# reporting

Form M compliance reports (spec 09): projections from events, `ComplianceReportWorkflow`, the Commission's review and sign-off, and federated submission. Contract: `packages/schemas/internal/reporting.yaml`. Port 4005 in development.

## Demo: federated Form M submission

A Commission running its own system files the same `form-m.v1` document a hosted Commission confirms, with a client-credentials token (scope `reports:submit`, `tenant` claim = the Commission) and an `Idempotency-Key`. The realm has a demo client for the Teachers Service Commission: `tsc-reports` (secret `tsc-reports-dev-secret`). Keycloak imports the realm only when it is new, so run `pnpm infra:reset` and `pnpm infra:up` once after pulling this client.

With `pnpm dev` running, from the repository root:

```sh
# 1. A token for the TSC system.
TOKEN=$(curl -s http://localhost:8080/realms/adili/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=tsc-reports -d client_secret=tsc-reports-dev-secret \
  | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).access_token")

# 2. The complete FY 2027 fixture as TSC files it for FY 2025 (a year whose reports are open).
node -e "
const d = require('./packages/schemas/forms/fixtures/form-m.v1/valid/complete-fy-2027.json');
delete d.meta;
Object.assign(d.partI, { commissionName: 'Teachers Service Commission', issuerCode: 'TSC',
  period: { from: '2025-07-01', to: '2026-06-30', financialYearStart: 2025 } });
process.stdout.write(JSON.stringify(d));" > tsc-form-m.json

# 3. Submit it. 201 with the RPT reference and source federated; the Form M PDF and the receipt
#    follow (formMDocumentId, receiptDocumentId). The same key again replays the same answer;
#    a new key for the same year is 409 report-submitted.
KEY=$(node -p "crypto.randomUUID()")
curl -s -X POST http://localhost:4005/v1/compliance-reports \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -H "idempotency-key: $KEY" --data @tsc-form-m.json
```

Errors are problem details: 400 `invalid-document` (schema) or `inconsistent-document` (period, counts against the lists, Part III) with the field paths in `errors`; 403 without the scope or with `tenant-mismatch` when Part I names another Commission than the token; 409 `report-submitted` for a year filed already.
