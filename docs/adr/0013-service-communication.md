# ADR-013: Service-to-service communication

- **Status:** Accepted; amended 2026-09-28 with the recorded exceptions in §8 (spec #27, spec 03), 2026-10-01 with the reporting service's (§2 timeouts, §8.7; spec 09), and 2026-10-02 with the declarations service's registry lookups (§2 timeouts, §8.8) and its suggestion decisions (§8.9; spec 05b); the depth limit and default timeout in §2 and the acting-tenant uses in §8.1 partly superseded by [ADR-017](0017-obligation-reminder-delivery.md) for the declarations service's calls (spec 04)
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-003](0003-temporal-as-workflow-engine.md), [ADR-004](0004-identity-keycloak-self-registration.md), [ADR-005](0005-message-queue-rabbitmq.md), [ADR-006](0006-multi-tenancy-and-hierarchy.md), [ADR-009](0009-api-first-interoperability.md), [ADR-012](0012-single-polyglot-monorepo.md)

## Context

~11 NestJS services plus the BFFs need to exchange queries, commands, facts and long-running processes. Requirements:
- Tenant context and the acting user must survive every hop (RLS, audit, "on behalf of").
- Statutory processes must not break when one service is slow or down.
- Contracts must be typed, versioned and testable (code quality).
- Nothing that needs a separate discovery server or service mesh for the hackathon.

## Decision

### 1. Three channels, one rule for choosing

| Need | Channel | Example |
|---|---|---|
| **Ask** something and need the answer now (query, or a command needing an immediate result) | **Synchronous HTTP/JSON (REST)** | console BFF → review: "list my queue"; declarations → documents: "presigned upload URL" |
| **Announce** that something happened (fact) | **Event via RabbitMQ** (outbox) | `declaration.submitted.v1` → documents issues the slip, notifications sends SMS, reporting updates counts, audit records |
| **Run a process** with several steps, deadlines, retries or compensation | **Temporal workflow** calling activities in the owning services | Submission processing, clarification timers, escalation ladder, Form M |

Default is **events**. Use synchronous calls only when the caller can't continue without the answer. Anything that waits days or chains more than two services goes to **Temporal**.

```mermaid
flowchart LR
    BFF["portal / console BFF"] -->|"REST + user token"| DEC["declarations"]
    BFF -->|"REST + user token"| REV["review"]
    DEC -->|"REST (token exchange)"| DOC["documents"]
    DEC -. "outbox → RabbitMQ<br/>declaration.submitted.v1" .-> MQ[["RabbitMQ"]]
    MQ -.-> DOC
    MQ -.-> NOT["notifications"]
    MQ -.-> REP["reporting (read model)"]
    MQ -.-> AUD["audit"]
    TW{{"Temporal<br/>DeclarationProcessingWorkflow"}} -->|"activity on review queue"| REV
    TW -->|"activity on integration queue"| INT["integration-gateway"]
    TW -->|"activity on ai queue"| AIG["ai-gateway"]
```

### 2. Synchronous calls

- **REST + JSON over HTTP**, the same style as the public API (ADR-009). Internal endpoints live under `/internal/v1` and are **never routed by the public Traefik entrypoint**.
- **Contracts:** OpenAPI 3.1 per service in `packages/schemas`. **Typed clients are generated** (`openapi-typescript` + `openapi-fetch`) into `packages/clients`, and requests and responses are validated with Zod at the boundary. CI fails on breaking contract changes (OpenAPI diff).
- **Discovery:** platform DNS (Docker Swarm service names on Dokploy; Kubernetes services in production). No discovery server.
- **Resilience defaults** in a shared HTTP client (`packages/api-kit`):
  - timeout 2s (configurable per call), deadlines propagated
  - retries only for idempotent requests (GET, or POST with `Idempotency-Key`), exponential backoff with jitter, max 2
  - circuit breaker per downstream (cockatiel)
- **Built so far:** `createServiceClient` in `packages/api-kit` wraps the generated client: the caller's client credentials token (§5), one retry after a 401 with a fresh token, the 2 s default timeout per attempt, and `call`, which validates the answer with Zod and turns everything the caller did not expect (no answer, another status, a body that breaks the contract) into the caller's own "unavailable" error. The directory's calls to documents (spec #27), notifications and the integration-gateway (spec 03) use it. **Not built yet:** retries with backoff and the circuit breaker; they land in `createServiceClient` with the first hop that needs them (the integration-gateway breaks its own upstream circuits, and roster file reads run in Temporal activities, whose retries cover transient failures).
- **Recorded timeout exceptions** (longer than the 2 s default, each with its reason):
  - directory → notifications `POST /internal/v1/messages` (onboarding codes): 6 s. The messages API is synchronous with a 5 s budget for its email or SMS provider (spec 03), and the declarant waits on the answer; the extra second covers the hop.
  - review → declarations `GET /internal/v1/declarations/{declarationId}/versions/{version}/document` and `.../previous-version` (spec 07a): 5 s. The document is one decrypted version; pulls for triage run in workflow activities, which retry, and a reviewer's case view shows the case without the document when it times out.
  - review → documents `POST /internal/v1/documents/issue` (clarification letters, spec 07a): 30 s. Rendering through Gotenberg and PAdES signing take seconds; it runs in a workflow activity, which retries, and issuing again answers the document already issued.
  - review → notifications `POST /internal/v1/messages` (clarification notices, spec 07a): 7 s. The messages API's 5 s provider budget plus the hop; sent from workflow activities, which retry under the same `Idempotency-Key`.
  - review → integration-gateway `POST /internal/v1/payroll/instructions` (salary stoppage and resumption, spec 08): 15 s. The gateway's payroll adapter answers within its own budget; instructions go out from workflow activities, which retry, and a replay of the same instruction reference answers the stored acknowledgement.
  - reporting (spec 09), all from Temporal activities that retry, except the ICMS push an EACC analyst waits on:
    - → notifications `POST /internal/v1/messages` (Form M reminders, chase, receipt): 7 s, the 5 s provider budget plus the hop; a retry carries the same `Idempotency-Key`, so nothing is sent twice.
    - → declarations `POST /internal/v1/obligations/details` and → review `POST /internal/v1/review/clarifications/details`: 10 s, a page is up to 1,000 records; review's `GET /internal/v1/review/referrals/{referralId}/icms-payload` shares the budget.
    - → integration-gateway `POST /internal/v1/icms/referrals`: 15 s; the gateway's adapter kit times ICMS out within it, and registration is idempotent by the referral reference.
    - → documents `POST /internal/v1/documents/issue` (Form M, receipt and NCR PDFs): 30 s, rendering through Gotenberg and PAdES signing take seconds; a retry carries the same `Idempotency-Key`.
  - declarations → integration-gateway `POST` KRA, NTSA, BRS and ArdhiSasa lookups (registry pre-fill, spec 05b): 5 s. The gateway times each registry out at 2 s behind its breaker, plus the hop and its cache and audit writes; lookups run in a workflow activity, which asks again with backoff while a registry does not answer (07b's rule) and then records it `unavailable`.
- **Depth limit:** at most **one synchronous hop** from a service (BFF → service → one dependency). Deeper chains become events or Temporal.
- **Hot reference data** (tenants, org tree, policies, numbering schemes, reference data from `directory`) is **cached locally**: Valkey plus in-process cache, invalidated by `directory.*.changed.v1` events. Services don't call `directory` on every request.

### 3. Events

- As ADR-005: **transactional outbox → RabbitMQ → idempotent consumers (inbox)**, CloudEvents envelope, AsyncAPI-documented, versioned types.
- **Events carry IDs and non-sensitive facts, not financial content.** A consumer that needs details calls the owner's API under its own authorisation.
- **Local read models** instead of cross-service queries. For example, `reporting` builds its own projection of obligations and submissions from events to compute Form M. It never queries the `declarations` database.

### 4. Temporal orchestration

- Workflows live in the service that owns the process (ADR-003).
- **Each service hosts its activities on its own task queue** (`review`, `documents`, `integration`, `ai`, `notifications`). A workflow in `declarations` calls a `review` activity by task queue; Temporal delivers it, with retries and timeouts, and no HTTP call is needed.
- Activities are idempotent (keyed by workflow and activity ID) and write domain state in their own service's database.

### 5. Identity and tenant context on every hop

- **User-initiated calls:** the BFF calls services with the user's access token (audience = target service). A service calling another service **exchanges** it for a token scoped to the next service (Keycloak standard token exchange, RFC 8693). The chain keeps `sub` (the user), `act` (the calling service) and tenant claims, so RLS and audit work end to end.
- **System-initiated work** (workflows, consumers, schedulers): service-account tokens (client credentials), with the originating user or system reason carried in `act` / audit context.
- **Tenant context comes from verified token claims, never from plain headers.** The shared `data-access` library sets the RLS context from the validated token.
- **Transport:** internal Docker network in the demo; mTLS between services in production (service mesh optional).

### 6. Observability

`traceparent` is propagated through HTTP headers, AMQP message headers and Temporal headers (OpenTelemetry interceptors), so one trace follows a submission from the browser through every service, queue and workflow step.

### 7. Hard rules (checked in CI and review)

1. **No shared databases** and no cross-service database access. Each service owns its schema.
2. **No importing another service's code**; only `packages/*` (ADR-012 boundary rules).
3. No synchronous call chains longer than one hop from a service.
4. No sensitive financial data in events, logs or trace attributes.
5. Every command endpoint accepts an `Idempotency-Key`.

### 8. Recorded exceptions

Deviations from the rules above, each narrow, with the reason and the controls that keep it safe. Add new ones here; do not widen these.

**8.1 Acting tenant in a header on internal routes (§5).** A service doing system work for a tenant (the directory reading a Commission's roster upload from documents inside an import workflow) has no user token to exchange. It calls with its own client credentials token and names the tenant in `X-Acting-Tenant` (`ACTING_TENANT_HEADER` in `packages/api-kit`). The callee trusts the header only when all of these hold:
- the route is under `/internal/v1`, which the public entrypoint never routes;
- the verified token carries the service scope for that internal API (e.g. `documents:internal`), which only named service clients get; a user token is refused whatever headers it sends;
- the resource is still checked against the named tenant: another tenant's resource is 404, as if it did not exist;
- the header is validated as a tenant key, never `platform`.

So the header chooses among the tenants a trusted service may act for; it never grants access by itself. Today: documents' `GET /internal/v1/uploads/{id}/download` (`ActingTenantGuard`), called by the directory (`HttpRosterUploads`). Token exchange (§5) replaces this once system work carries an originating user or tenant claim.

**8.2 No `Idempotency-Key` on endpoints that return a secret (§7.5).** Creating, rotating and revoking a Commission's HR-system API credential (directory `/v1/commissions/{slug}/roster/api-credential`) take no key: the idempotency store keeps the response for replay, and the create and rotate responses carry the client secret, which the platform must never store. Retries stay safe without it: create is refused with 409 while a credential exists (a retry after a lost response is told to rotate or revoke), rotate issues a fresh secret (the lost one is useless), and revoke of a revoked credential is 404, leaving the same end state.

**8.3 No `Idempotency-Key` on the onboarding steps before confirm (§7.5, spec 03).** The public onboarding API (directory `/v1/onboarding`, no bearer token) takes a key on the two steps whose effect cannot be told apart from a second one: confirm (creates the account) and resend-password-email (sends an email). There the key belongs to the session and the secret presented (a keyed hash of both, `SessionIdempotencyKey`), since there is no token `sub`, so only the secret's holder gets a stored answer back. The other steps take none:
- identify (`POST /v1/onboarding/sessions`) returns the session secret, which the idempotency store must not keep (as in 8.2). A retry just opens a fresh session (the lost one lapses at its expiry, 30 minutes), and it is rate limited per client IP and per client IP and Commission;
- verify, resend and provide-contact (`/otp/{channel}/verify`, `/otp/{channel}/resend`, `/contacts`) each move the session's state machine one step, scoped by the session id and secret. A replay is refused by the state check (409 `wrong-step` once the step is done), by the one-minute resend cooldown (429 `resend-cooldown`), or counts as one more attempt against the code's five, never as a second effect.

**8.4 No `Idempotency-Key` on reopening and discarding an amendment (§7.5, spec 06).** The declarations service's `POST /v1/declarations/{id}/amend` and `POST /v1/declarations/{id}/amend/discard` take no key. Each answers with the declaration and its `ETag`, which a client needs for its next section save (`If-Match`); the idempotency store keeps only status and body, so a replay would answer without it. Neither needs a key to be safe to retry, because each is idempotent by the declaration's state, decided under its row lock: a retried amend finds the declaration `amending` and answers it as it is, copying nothing and recording no second `declaration.amendment-started.v1`; a retried discard finds it `submitted` and answers it as it is. Two requests at once make one change and one event.

**8.5 Acting tenant on the acknowledgement slip's internal routes (§5, spec 06).** The routes below take the tenant in `X-Acting-Tenant` from a service's client credentials token, each under every control of 8.1 (`InternalApi(scope)` and `@ActingTenant()` from `packages/api-kit`; the resource checked against the named tenant, 404 otherwise):
- declarations' `GET /internal/v1/declarations/{declarationId}/versions/{version}/acknowledgement-payload` (scope `declarations:internal`, audited), pulled by the documents service's acknowledgement issuer, an event consumer with no user token, after `declaration.submitted.v1` or `declaration.acknowledgement-requested.v1`;
- documents' `POST /internal/v1/documents/issue` and `POST /internal/v1/documents/{documentId}/supersede` (scope `documents:internal`), how a service issues a document for the tenant it names and supersedes one of its documents; today only the documents service's own acknowledgement issuer issues, in process, so no service calls them over HTTP yet;
- documents' `POST /internal/v1/uploads/{id}/linked` (scope `documents:internal`), called by declarations when it links an attachment to an item and when a discarded amendment links one again.

**8.6 Acting tenant on the review service's internal calls and routes (§5, spec 07a).** Each under every control of 8.1 (`InternalApi(scope)` and `@ActingTenant()` from `packages/api-kit` on the callee; the resource checked against the named tenant, 404 otherwise):
- review calls, with its own client credentials token and the Commission in `X-Acting-Tenant`: declarations' `GET /internal/v1/declarations/{declarationId}/versions/{version}/document` (scope `declarations:internal`; the read also names the staff subject in `X-Acting-Subject` and the case in `X-Review-Case`, which declarations records in its audit event), `GET /internal/v1/declarations/previous-version`, `GET /internal/v1/obligations/{obligationId}` and `GET /internal/v1/persons/{personId}/obligations` (spec 08); the directory's `GET /internal/v1/commissions/{slug}/policy`, `GET /internal/v1/commissions/{slug}` and `GET /internal/v1/commissions/{slug}/roster/records/{recordId}` (`directory:internal`), and that record's `GET .../national-id` (`directory:roster-national-id`, a scope of its own held by review alone: payroll's salary stoppage and the ICMS referral identify the officer by it); documents' `GET /internal/v1/uploads/{id}/download`, `POST /internal/v1/documents/issue`, `POST /internal/v1/documents/{documentId}/revoke` and `GET /internal/v1/documents/{documentId}` (`documents:internal`). Payroll instructions to the integration-gateway name the employer in the body and act for no tenant. Its messages to notifications carry the tenant in the body, as every caller's do, not in the header. The reads in a reviewer's request (case view, issuing a clarification) carry that reviewer as `X-Acting-Subject`; triage in workflows carries `system:review`.
- review's own routes (scope `review:internal`): `GET /internal/v1/review/clarifications/{clarificationId}/letter-payload`, served from the letter review fixed when it issued the clarification, so it calls no other service (§7.3); the decision and action letter payloads (`/determinations/{determinationId}/letter-payload`, `/actions/{actionId}/letter-payload`) and the referral package payload (`/referrals/{referralId}/package-payload`, audited), all pulled by the documents service when it renders them (spec 08); and `GET /internal/v1/review/referrals/{referralId}/icms-payload` (audited), pulled by reporting when an EACC analyst pushes a referral to ICMS (spec 09).
- **`X-Acting-Subject`.** On the same internal routes, a service reading for a person names them in `X-Acting-Subject`: review naming the reviewer to declarations, reporting naming the EACC analyst to review. The callee records it as the actor's `on-behalf-of` in the read's audit event (ADR-008) and grants nothing on it; `AuditedReadInterceptor` in `packages/events` reads it (and `X-Acting-Tenant`) only once `InternalApi(scope)` admitted the call, a service token with the route's internal scope, so no other caller can name whom it acts for.

Token exchange (§5) replaces these with 8.1's.

**8.7 Acting tenant and acting subject on the reporting service's internal calls (§5, spec 09).** The reporting service compiles each Commission's Form M, issues its documents and chases it from Temporal activities and event consumers, with no user token to exchange. It calls with its own client credentials token, through clients generated from the callees' contracts, and names the Commission in `X-Acting-Tenant` on these routes, each under every control of 8.1 (the path slug, when there is one, must equal the header; another Commission's resource is 404, or left out of a batch):
- directory's `GET /internal/v1/commissions/{slug}` and `GET /internal/v1/commissions/{slug}/staff?role=` (scope `directory:internal`): the Commission's name and issuer code for Form M Part I and its reference, and the staff a reminder or the chase is emailed to. The list of every Commission, `GET /internal/v1/commissions`, takes the scope alone, as in ADR-017: public reference data, no tenant to act for, never `platform`;
- declarations' `POST /internal/v1/obligations/details` (scope `declarations:internal`) and review's `POST /internal/v1/review/clarifications/details` (scope `review:internal`): batch reads naming the officers on Form M's non-filer and clarification rows;
- documents' `POST /internal/v1/documents/issue` (8.5), for the Form M, receipt and NCR PDFs;
- review's `GET /internal/v1/review/referrals/{referralId}/icms-payload` (scope `review:internal`), read when an EACC analyst pushes a referral to ICMS. It also names the analyst in `X-Acting-Subject`, as declarations' internal document reads name the officer for review: review's audit of the read records who caused it. The header is trusted on the same terms as the acting tenant (internal route, service scope, never a grant by itself) and only names; it widens nothing the token may read.

**8.8 The declarant's national ID and acting tenant on the declarations service's registry lookups (§5, spec 05b).** A declarant checking registries about themselves or their household runs a workflow, with no user token to exchange. The declarations service calls with its own client credentials token:
- the directory's `GET /internal/v1/persons/{personId}/national-id` (scope `directory:person-national-id`, held by declarations alone), for the officer's own lookups only (a spouse's or child's national ID comes from the household section). It answers the national ID on the person record, as verified with IPRS at onboarding, not the roster record's, which a later roster push can change; the roster record's stays review's alone (8.6). The directory answers 404 for a person not onboarded at the acting tenant. The ID is read in the activity at the moment of the lookup and passed to the gateway only; it never enters a log, event, table or workflow history;
- the integration-gateway's KRA, NTSA, BRS and ArdhiSasa lookups (scope `registry`, the national ID in the body; spec 07b), naming the Commission in `X-Acting-Tenant` under every control of 8.1 (the stored verification result is the Commission's, and only its services read it back), with legal basis `declarant-request`, the declaration as `X-Case-Ref` and the declarant as `X-Subject-Person`, whoever of the household is looked up.

The lookup activity's retries (a registry that did not answer is asked again with backoff, and a failed activity is retried by Temporal) re-POST the gateway's lookups without an `Idempotency-Key`, which §2's retry rule otherwise asks of a retried POST. Each lookup is a read with no effect on the registry or on what the declarant holds: a repeat is answered from the gateway's cache, or asks the registry again, and only records another lookup in the gateway's audit, as any read does. The activity writes its answer once, under the set's row lock, and only while the set is `pending`.

Notifications' `POST /internal/v1/messages` and the gateway's ICMS routes take no acting tenant: the message carries its `tenant` for audit and branding, and ICMS registrations are keyed by the referral reference. Token exchange (§5) replaces these with 8.1's once system work carries an originating user or tenant claim.

**8.9 No `Idempotency-Key` on accepting and dismissing a registry suggestion (§7.5, spec 05b).** The declarations service's `POST /v1/declarations/{id}/suggestions/{suggestionId}/accept` and `.../dismiss` take no key, as 8.4. Accept is a section save on the declarant's behalf: it answers with the draft's new `ETag`, which the client needs for its next save (`If-Match`), and the idempotency store keeps only status and body, so a replay would answer without it. Neither needs a key to be safe to retry:
- accept is decided under the suggestion's row lock, in the transaction of the section save it makes, which goes ahead only at the version sent in `If-Match`. A retry after a lost answer finds the suggestion `accepted` and answers 409 `not-new`; the client reads the section again for its current `ETag`. Two accepts at once make one change and one `declaration.suggestion-accepted.v1`: the other answers 409 (`draft-version-mismatch` or `not-new`);
- dismiss is idempotent by the suggestion's state: dismissing a dismissed suggestion answers it as it is, keeping the first reason and recording no second `declaration.suggestion-dismissed.v1`. It is decided under the same row lock, so two at once make one change and one event.

## Alternatives considered

| Option | Why not |
|---|---|
| gRPC internally | Faster and typed, but adds a protobuf toolchain next to the REST/OpenAPI we must publish anyway (ADR-009); harder to debug and to explain to EACC ICT teams. Performance isn't our bottleneck. |
| NestJS TCP/Redis microservice transports for request/response | Proprietary framing, weak contracts, no OpenAPI; ties callers to NestJS. |
| GraphQL federation between services | Heavy for this team and timeline; complex authorisation per field; REST + read models is simpler. |
| Everything via events (no sync calls) | Awkward for user-facing queries that need immediate answers. |
| Everything via sync calls | Tight coupling and cascading failures at the December peak. |
| Service mesh now (Istio/Linkerd) | Operational overhead for the demo; mTLS via mesh stays a production option. |

## Consequences

**Positive**
- Clear, teachable rule: *ask → REST, announce → event, process → Temporal*.
- Services keep working when a neighbour is slow (events, read models, circuit breakers).
- The user and tenant context survives every hop, so RLS and audit are correct end to end.
- Typed generated clients and contract diff checks make breaking changes visible.

**Negative / risks**
- Read models are eventually consistent (seconds). Acceptable for dashboards and Form M; user-facing confirmation comes from the owning service's response.
- Token exchange adds a Keycloak call per hop. Mitigated by caching exchanged tokens until expiry.
- Three channels means developers must choose correctly. Covered in the service template, code review and the rule table above.
