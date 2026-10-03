# Spec 08 contract convergence: determinations, administrative actions and referrals

How the contracts drafted for spec 08 (#191, contract PR #192) compare with what was built, after #444, #458, #482 and #484.
Each difference below was decided in the ticket named; the generated contract in `packages/schemas/internal/<service>.yaml` is now the source of truth.
The ladder's move from `FilingObligationWorkflow` to review's `EnforcementWorkflow` is recorded in [ADR-003](../adr/0003-temporal-as-workflow-engine.md) decision 8.

## State

| Contract | Source | Drafts left | Drift check |
|---|---|---|---|
| `internal/review.yaml` | exported from `services/review` (`pnpm --filter @adili/review contracts`, since #175) | none (review has no draft file) | `pnpm contracts:drift` |
| `internal/integration-gateway.yaml` | exported | none (`drafts/integration-gateway.yaml` deleted by #482) | same |
| `internal/declarations.yaml` | exported | `drafts/declarations.yaml`: specs 05b and 11 only | same |
| `internal/documents.yaml` | exported | none | same |
| `internal/notifications.yaml` | exported | none | same |

Every operation #192 drafted is built, under the operation id and path it drafted: 23 in review, 2 in the integration-gateway, 1 in declarations.
Console, portal, access, documents, reporting and review clients (`*.gen.ts`) are generated from these files, and the drift check fails when one is stale.

## Review (`internal/review.yaml`)

Operations added (not in the draft):

- `internalGetDeterminationLetterPayload`, `internalGetActionLetterPayload`, `internalGetReferralPackagePayload` (added by #200, #206 and #212 in #444; documents consumes them since #194, #484): documents pulls a letter's or package's fields by record id instead of trusting the caller's body (ADR-010). Each payload carries `declarantPersonId`, which documents checks against the subject person. The package pull has a 15 s budget, and its three hops are ADR-013 §8.11's exception.
- `internalGetReferralIcmsPayload` (#237, in #444): what reporting pulls when EACC pushes a sent referral to ICMS, with the declarant's national ID read from the directory at each call. 409 `roster-record-unknown`.

Operations changed:

- Every spec 08 write accepts `Idempotency-Key` (ADR-013 §7.5). `approveDetermination`, `approveBulkClosures`, `approveAction`, `approveReferral` and `respondToNotice` require it, as the draft did; propose, return, withdraw, decline, restart and reassign accept it.
- `approveBulkClosures` documented `Idempotency-Key` twice (also as `idempotency-key`), so a generated client had to send both. Fixed in #213: it is documented once, and `exportContract` now refuses a parameter documented twice.
- Every operation documents its problems. The codes a client branches on:
  - 403 `separation-of-duties` (the caller proposed it or held the case) and `supervisor-required` on approve, return and decline; `not-the-assignee` on propose; `not-the-proposer` on withdraw.
  - 409 `not-proposed` on every decision; `determination-open` and `clarification-open` on `proposeDetermination` (#200: no determination while a clarification of the case is open); `referral-open` on `proposeReferral`; `ladder-not-declined` on `restartLadder`; `already-responded`, `notice-closed`, `attachment-not-clean`, `attachment-not-accepted` on `respondToNotice`; `not-approved` on `getDeterminationLetter`.
  - 503 when the directory (approvals, bulk closures) or documents (letters, attachments) cannot be reached; 502 when documents refuses a letter.
- `reassignApproval`: answers `ApprovalReassignment` (`kind`, `subjectId`, `reassignedTo`) instead of an empty 200 (#200).
- `getDeterminationLetter`: `LetterDownload.downloadUrl` is null for staff, who download by `documentId` through documents as for clarification letters, and `expiresAt` is gone (#203).
- Query enums (`kind`, `status`, `step`, `type`) are inlined rather than `$ref`s, and nullables are `anyOf [..., null]` (code-first export). The values are the draft's.

Schemas changed:

- `Determination`: `furtherActionNote`, `furtherActionLink` (`FurtherActionLink`: `kind` action or referral, `id`, of the same Commission and declarant), `returnedBy`, `returnedAt` (#200). `DeterminationInput` gains `furtherActionLink`.
- `ApprovalItem`: unchanged apart from nullables. Bulk closures are not in the inbox (#203); they have their own screen.
- `ClosureSummary`: `lastSweptAt`, null before the first sweep, for the "no sweep yet" state (#203).
- `BulkApprovalResult`: `skipped`, closures of cases the approver once held, left by the separation rule (#203).
- `AdministrativeAction`: `proposer`, `declinedBy`, `declinedAt`, `declineNote`, `issuedAt` (#206).
- `Ladder`: `closingCause` (`filed`, `clarification-responded`, `clarification-resolved`, `obligation-cancelled`, `clarification-withdrawn`), so a ladder that ended without compliance reads apart from one that complied (#206, #209).
- `DeclarantNotice.response`: a closed object with `text`, `attachments` and `submittedAt` required (#206).
- `Referral`: `caseId` (the case it was proposed from, or whose clarification went unanswered; null for two missed cycles), `cycleYear`, `approvedAt`, `declinedBy`, `declinedAt`, `declineNote`, `evidence` (on `getReferral` only: kind and reference of each included item), `package.manifest` items as the named `ReferralManifestItem` (#212); `icmsCaseNumber`, `icmsRegisteredAt` (#237).
- `ReferralInput`: `flagIds` 1 to 100, `clarificationIds` up to 50 (#212).
- New: `DeterminationLetterPayload`, `ActionLetterPayload`, `ReferralPackagePayload`, `ReferralManifestItem`, `ReferralManifestKind`, `ReferralIcmsPayload`, `FurtherActionLink`, `ApprovalReassignment`.

## Integration-gateway (`internal/integration-gateway.yaml`)

- `submitPayrollInstruction`, `getPayrollInstruction` (#195, #482): scope `payroll`, held by review only; no `X-Acting-Tenant` (the instruction names the reporting entity by `employerCode`). `X-Legal-Basis` is required and only `am-sanctions` (an inline enum, not the shared `LegalBasis`); `X-Case-Ref` optional.
- No `Idempotency-Key`: idempotent by `instructionReference` (ADR-013 §8.10). The same reference with other particulars is 409 `instruction-reference-conflict`; with the same ones, 200 and the stored acknowledgement.
- 503 when payroll is down, timed out, paused or its breaker is open: nothing is recorded as sent, and review retries while the action is `approved-pending-payroll`.
- `PayrollInstruction.status` keeps `accepted | pending | failed`, but the payroll system only answers `accepted` today; pending and failed are reserved.

## Declarations (`internal/declarations.yaml`)

- `internalListPersonObligations` (#196, #458): `tenant` moved from the query to `X-Acting-Tenant`; the response is the named `InternalPersonObligation` array, oldest first, no names, audited with the person. 400, 403 and 404 documented.
- Added `internalGetObligation` (drafted by #206 in #444, served by #458 for #196): the ladder reads the overdue obligation it starts on, audited.

## Documents (`internal/documents.yaml`)

- The draft's document types and the `action-response` upload purpose are built as drafted (#194, #484). The letters are Restricted and the package Confidential; the template decides the disclosure level, and the issue body refuses one (400).
- `DecisionLetterSource`, `ActionLetterSource`, `ReferralPackageSource`: the record each template pulls from review.
- Added `internalGetDocument` (drafted by #212 in #444, served by #484 for #194): review reads the letters' SHA-256 for the package manifest.

## Notifications (`internal/notifications.yaml`)

- The draft's `decision`, `notice`, `salary-stopped` and `salary-reinstated` templates (email and SMS) are built (#194, #484). Their params take `commission`, where older templates take `commissionName`, and a `portalUrl`; none attaches a letter. The disciplinary referral sends no message: it goes to the reporting entity as an event (`action.disciplinary-referred.v1`).

## Events

Built as the spec lists them, plus (ids and outcomes only):

- `determination.withdrawn.v1`, `approval.reassigned.v1`, `ladder.restarted.v1`, `action.cancelled.v1`, `action.disciplinary-referred.v1` (review, #444).
- `referral.icms-registered.v1` (review consumes it from reporting, #237).
- `payroll.instruction.submitted.v1` and `payroll.instruction.unacknowledged.v1` from the gateway (#482), next to review's `payroll.instruction.sent.v1` and `acknowledged.v1`.

Review's event types and payloads live in the review service (`src/*/events.ts`), as #444 built them, not in `@adili/events/contracts` as access's do; no ticket moves them. Reporting parses the ones Form M counts (`action.*`, `determination.approved.v1`, `referral.sent.v1`) with its own Zod schemas in `services/reporting/src/projections/events.ts`.
