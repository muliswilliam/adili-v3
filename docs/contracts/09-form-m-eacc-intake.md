# Spec 09 contract convergence: Form M and EACC intake

How the contracts drafted for spec 09 (#214, contract PR #215) compare with what was built, after #446, #458, #482 and #484.
Each difference below was decided in the ticket named; the generated contract in `packages/schemas/internal/<service>.yaml` is now the source of truth.

## State

| Contract | Source | Drafts left | Drift check |
|---|---|---|---|
| `internal/reporting.yaml` | exported from `services/reporting` (`pnpm --filter @adili/reporting contracts`, since #238) | `drafts/reporting.yaml`: spec 09b only (NCR pattern candidates and AI narrative drafting, open-data releases) | `pnpm contracts:drift` |
| `internal/integration-gateway.yaml` | exported | none | same |
| `internal/declarations.yaml` | exported | `drafts/declarations.yaml`: specs 05b and 11 only | same |
| `internal/review.yaml` | exported | none | same |
| `internal/directory.yaml` | exported | none | same |
| `internal/documents.yaml` | exported | none | same |
| `internal/notifications.yaml` | exported | none | same |
| `forms/form-m.v1.json` | hand-written | n/a | `pnpm --filter @adili/schemas lint:forms` (meta-validation and compile), fixtures in `forms/fixtures/form-m.v1` (valid and invalid) checked by `@adili/forms` tests (`form-m.test.ts`, every file in the folder) |

Every operation #215 drafted for spec 09 is built, under the operation id and path it drafted: 16 in reporting, 2 in the integration-gateway. Reporting also serves spec 07c's `getAiUsage` (#272).
With reporting, every service that serves an internal API exports its contract.
The console's reporting client (`apps/console/src/server/reporting/api.gen.ts`) is generated from it, for the spec 09 screens (#222, #225, #229), and the drift check fails when it is stale.

## Reporting (`internal/reporting.yaml`)

Until #238 this file was hand-written: the backend PRs (#446, #234, #237, #272) edited it next to the code, and the integration tests checked the answers against it.
It is now exported from the controllers and Zod schemas (`services/reporting/src/openapi.ts`).
Each representation the service answers with is checked at compile time against the schema that documents it (`Conforms` in `src/conforms.ts`), and the integration tests still validate the answers against the exported file.

Operations: none added, none dropped, none moved. Changed:

- **Request bodies are documented.** The hand-written file had them, but the code did not: a client generated from the code alone would have sent untyped bodies. `ManualFields` gains the limits the service enforces: `emailAddress` at most 254 characters, at most 500 `complaints`. Confirm's optional body is the named `ConfirmReport`.
- **Success bodies are named schemas** instead of the code's bare descriptions.
- **Problems documented that the draft left out:**
  - 400 when `fy` is not a financial year, on `getComplianceReport`, `compileComplianceReport` and the four NCR operations.
  - 422 (Idempotency-Key reused with another request) on `approveNationalReport` and `pushReferralToIcms`, as on the other keyed writes.
- `submitComplianceReport`: the body is the named `FormM`, the full `form-m.v1` schema (from `@adili/forms` `FormMSchema`, as documents' `FormMPayload`), instead of any object. The service validates it against `forms/form-m.v1.json` (`invalid-document`).
- `getSubmittedReport` answers `SubmittedComplianceReport`: a `ComplianceReport` whose `document` is the frozen `FormM`. The Commission's own `getComplianceReport` keeps the loose `FormMDocument`, because a draft need not be complete yet. `FormM`'s parts are not named components: naming the declaration section makes Zod export biennial's intersection as an `allOf` of two closed objects, which no document satisfies. documents' `FormMPayload` had that defect, fixed in #238.
- `listReferralIntake`: `icmsStatus` is an inline enum, and `cursor` (1 to 200 characters) is documented as the previous page's `nextCursor`.
- `getEaccIntake`: `status` refers to `IntakeStatus`, `fy` is described.
- The draft's shared `parameters` (`Slug`, `FinancialYear`, `IdempotencyKey`) and `responses` (`NotFound`, `Forbidden`) are inlined per operation (code-first export). The 09b drafts keep using them, from `drafts/reporting.yaml`.

Schemas changed:

- New: `ReportCounts` (was `counts: object`), `NationalAggregates` (was `aggregates: object`), `FormMDocument` (was `document: object`, for drafts), `FormM` (its parts unnamed, see below), `SubmittedComplianceReport`, `ConfirmReport`, `ReferralIntakePage` (was inline).
- `ComplianceReport.counts` and `NationalReport.aggregates` are the typed shape, or `{}` before the first compile or build.
- Every field the draft listed is there, with the same names and required fields; descriptions added from the code.
- Nullables are exported as `anyOf [..., null]` rather than `type: [..., 'null']`, and `Officer | null` as `anyOf` rather than `oneOf`.
- `ProblemDetails.code` is the shared enum of `@adili/api-kit` `PROBLEM_CODES`, as in every exported contract, instead of the hand-written `string`. Reporting's codes are now registered there (#238): `report-submitted`, `report-compiling`, `preview-not-available`, `not-reviewed`, `invalid-remarks`, `invalid-document`, `inconsistent-document`, `tenant-mismatch`, `ncr-approved`, `no-submitted-reports`, `icms-push-failed` and `separation-of-duties`, next to the already registered `incomplete` (now titled "Form incomplete", as it covers Form M too) and `step-up-required`.
  - Every coded problem goes through `problem(code, ...)` (`ProblemException.fromCode`), so the registry's status and title are on the wire and the code is the `type`, as in access. The `about:blank` types and generic titles are gone.
  - `problem` takes a `ProblemCode`, so a code reporting sends through its helpers must be registered first. api-kit does not enforce this for every service: `ProblemExtensions.code` is still a free string, and review sends unregistered codes (#501).
  - Every contract and client is regenerated with the longer enum.

### Spec 09b drafts

`getNationalReportCandidates`, `draftNationalReportNarrative`, `listOpenDataReleasesEacc`, `buildOpenDataSnapshot`, `publishOpenDataRelease`, `withdrawOpenDataRelease`, `getCommissionOpenDataPreview` and the public `listOpenDataReleases`, `getOpenDataRelease`, `getOpenDataTable` moved unchanged into `drafts/reporting.yaml`, with `PatternCandidate`, `OpenDataTable`, `OpenDataRelease` and the parameters and responses they use.
The export marks them `x-draft: true`.

PR #491 (spec 09b backend) edits `internal/reporting.yaml` by hand. Once #238 merges, that file is generated, so #491's rebase conflicts on it. Taking the generated file as is would undo #491's contract changes. Instead:

1. **The five operations it implements** (`getNationalReportCandidates`, `draftNationalReportNarrative`, `listOpenDataReleasesEacc`, `buildOpenDataSnapshot`, `getCommissionOpenDataPreview`):
   - document them on its controllers (`@ApiOperation`, `@ApiBody`, `schemaRef`);
   - delete them from `drafts/reporting.yaml`, because the export refuses an operation both define.
2. **The components they use** (`PatternCandidate`, `OpenDataRelease`, `OpenDataTable`) become Zod schemas in `OPENAPI_SCHEMAS`, each with a `Conforms` check, and leave the draft. The export also refuses a component the draft and the code both define (`withDraft` in api-kit `contract.ts`). The five operations still drafted (`publishOpenDataRelease`, `withdrawOpenDataRelease`, the public `listOpenDataReleases`, `getOpenDataRelease`, `getOpenDataTable`) keep `$ref`-ing them, which works because a draft may reference implemented components.
3. **Its changes to operations already converged here:**
   - `NationalReport.narrativeDraft` and the new `NarrativeDraft` schema go into `nationalReportSchema` (with `Conforms`) and `OPENAPI_SCHEMAS`.
   - The new `getNationalReport` description (the `drafting` narrative draft looked up at the ai-gateway) goes on `national-reports.controller.ts`.
   - None of these can stay in the draft.
4. **Its problem codes** are registered in `PROBLEM_CODES`: `ai-not-enabled`, `narrative-validation`, `no-pattern-candidates`, `aggregates-rebuilt`, `narrative-draft-failed`, `ncr-not-built`, `reconciliation-failed`. Reporting's problem helpers take a `ProblemCode`, so #491's calls do not compile until they are registered. Its `conflict(code, ...)` calls become `problem(code, ...)`, the single coded helper, now built on `ProblemException.fromCode`.
5. Run `pnpm --filter @adili/reporting contracts`, then `pnpm contracts:drift`, and regenerate the clients: the `ProblemDetails.code` enum grows in every contract.

#238 adds no migrations, so #491's 0009 and 0010 do not conflict with it.

### PR #493 (Form M section 5 from access events, #467)

#493 changes section 5 while this PR is open, and is not merged into it:

- It edits `submitComplianceReport`'s description in `internal/reporting.yaml` by hand: "the decline reasons add up to declined" becomes "the decline reasons count at least every decline (a denial citing several grounds counts under each)", next to the looser rule in `federated-submission.ts`. On this branch, the contract states the rule this branch enforces ("add up to declined"), so a Commission that follows it is never refused. Whichever of #493 and #238 merges second carries both the rule and the sentence. The sentence then lives in `federated-reports.controller.ts`, and the file is re-exported, never edited by hand.
- Its other changes (the `access_request_facts` projection, migration 0009, `form-m.ts` compiling section 5, `dataUnavailable` false for hosted reports) touch no HTTP contract. `ComplianceReport.accessDataUnavailable` and `ReportCounts.accessRequests` keep their shape.
- It updates `docs/contracts/10-access-requests.md`, which this PR does not touch.

## Integration-gateway (`internal/integration-gateway.yaml`)

- `submitIcmsReferral`, `getIcmsReferral` (#219): scope `icms`, held by reporting only; no `X-Acting-Tenant` (the referring Commission is in the referral, ADR-013 §8.7). `X-Legal-Basis` is required and only `regs-r20-referral` (an inline enum, not the shared `LegalBasis`); `X-Case-Ref` optional.
- No `Idempotency-Key`: idempotent by `referralReference`. The same reference for another declarant or Commission is 409 `referral-reference-conflict`; for the same one, 200 and the stored registration, without calling ICMS.
- 503 `upstream-unavailable` when ICMS is down, timed out, paused or its breaker is open: nothing is registered, and reporting retries with backoff.
- `IcmsReferralRequest` gains patterns and lengths: `referralReference` (up to 40 characters), `nationalId` (5 to 10 digits), `referringCommission` (the issuer code), `fullName` and `grounds` (1 to 200), and refuses unknown keys. Only the national ID is kept, as a keyed hash.
- `IcmsReferral.status` keeps `registered | pending | failed`, but ICMS registers as it receives, so the gateway answers `registered` with a case number today; pending and failed, and a null `caseNumber` or `registeredAt`, are reserved.
- `getIcmsReferral`: `referralReference` has the request's pattern; 403 and 404 documented.

## Declarations, review and directory (#220, in #458)

The spec drafted these internal reads for Form M in the BE detail, not in #215; #458 built them from `drafts/declarations.yaml` and `drafts/directory.yaml`.

- Declarations `internalObligationDetails` (`POST /internal/v1/obligations/details`): the officers behind 1 to 1,000 obligations, obligations of another Commission left out, audited with the ids returned.
- Review `internalClarificationDetails` (`POST /internal/v1/review/clarifications/details`): Form M section 4's officer and the kinds of requirement asked for, never the content, audited with the ids returned.
- Review `internalGetReferralIcmsPayload` (#237, in #444): what reporting pulls to push a referral to ICMS (see `08-determination-actions.md`).
- Directory `internalListCommissionStaff` (`GET /internal/v1/commissions/{slug}/staff?role=`): enabled accounts holding `reporting-officer`, `supervisor` or `commission-admin` with a verified email; `role` is an enum.
- Dropped: the review "action summary by person" the BE detail planned. Reporting takes each non-filer's latest action step and compliance status from its projection of review's `action.*` and `determination.approved.v1` events instead (ADR-013: projections from events).

## Documents (`internal/documents.yaml`)

- `DocumentType` gained `form-m`, `compliance-report-receipt` and `ncr`, as drafted (#218, in #484), with `FormMPayload`, `ComplianceReportReceiptPayload` and `NcrPayload`. The reporting service sends the payload (the frozen `form-m.v1` document, the receipt's reference, SHA-256 and time, the approved NCR's aggregates and narrative); none has a subject person.
- `getDocumentDownload`: a Commission's supervisor, commission-admin, reporting officer or federated system downloads its own Form M and receipt; EACC analysts and supervisors every Commission's, and the NCR.

## Notifications (`internal/notifications.yaml`)

- `TemplateId` gained `form-m-draft-ready-email`, `form-m-reminder-email`, `form-m-receipt-email` and `form-m-chase-email`, as drafted (#218, in #484). Emails only, to a Commission's staff, each with a `financialYear` (`2027/2028`); they attach nothing.

## Events

Built as the spec lists them (ids, counts and references only):

- `compliance-report.drafted.v1`, `.reviewed.v1`, `.submitted.v1`, `.reminder-sent.v1`, `.chased.v1`.
- `ncr.drafted.v1`, `ncr.approved.v1`.
- `referral.icms-pushed.v1`, `.icms-registered.v1` (review consumes it to show the case number), `.icms-push-failed.v1`.

Their types live in the reporting service (`src/*/events.ts`), as review's do.

## Follow-ups

- Review still sends codes `PROBLEM_CODES` does not hold (`not-proposed`, `supervisor-required`, ...), so its generated clients mistype them. Ticket: #501.
