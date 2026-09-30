# ADR-016: Service calls for filing obligations and their reminders

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** Adili V3 DIALs team
- **Supersedes:** [ADR-013](0013-service-communication.md) in part, for the declarations service's calls (spec 04): the depth limit and the 2 s default timeout in §2, and the uses of the acting tenant header in §8.1. The rest of ADR-013 still stands.
- **Related:** [ADR-003](0003-temporal-as-workflow-engine.md), [ADR-005](0005-message-queue-rabbitmq.md), [ADR-006](0006-multi-tenancy-and-hierarchy.md), [ADR-017](0017-person-scoped-row-level-security.md)

## Context

Spec 04 derives filing obligations in the declarations service from the directory's roster and policy, and reminds declarants of them by SMS and email through the notifications service. That needs synchronous calls ADR-013 does not cover as written:

- The declarations service pulls roster records (pages of up to 1,000), a roster record, the Commission's policy and its reference (slug, issuer code, name) from the directory's internal API, in event consumers and workflow activities.
- A reminder is sent by a Temporal activity in declarations (`sendReminder`), which calls notifications (`POST /internal/v1/messages`, recipient by person), which reads the person's verified contacts from the directory (`GET /internal/v1/persons/{personId}/contacts`) before it hands the message to its provider: two synchronous hops from the activity, where ADR-013 §2 allows one.
- None of these calls carries a user: they are system work for a Commission.

## Decision

1. **Acting tenant (ADR-013 §8.1) on the directory's internal API.** The declarations service calls the directory's Commission reference, roster record and policy pulls under `/internal/v1/commissions/{slug}` with its own client credentials token (scope `directory:internal`) and the Commission in `X-Acting-Tenant`; the path slug must equal the header, and another Commission's resource is 404. The notifications service calls `GET /internal/v1/persons/{personId}/contacts` (scope `directory:person-contacts`, held by the notifications client alone) naming the tenant it sends for; there the check is that the person is onboarded at that tenant (a roster record of it carries the person), else 404. Every one of §8.1's controls applies; both use `InternalApi(scope)` and `@ActingTenant()` from `packages/api-kit`, and `createServiceClient` on the caller's side.
2. **Two synchronous hops for an obligation reminder** (an exception to ADR-013 §2's depth limit and §7 rule 3). Resolving a person to a contact is notifications' job, so the chain activity → notifications → directory stays, with these controls:
   - the first hop is a retried, idempotent Temporal activity (`Idempotency-Key` per reminder and channel), with nobody waiting on it;
   - the second hop is bounded by notifications' own 5 s budget (the contact lookup takes at most 1 s of it), cached for 10 minutes per person and tenant, and a failed lookup is reported as `contact-lookup-failed`, which the activity retries later;
   - no third hop is allowed on this path.
3. **Timeouts other than the 2 s default** (ADR-013 §2), each with its reason:
   - declarations → notifications `POST /internal/v1/messages`: 8 s. The messages API spends up to 5 s on the contact lookup and the provider; nobody waits (a Temporal activity), so the margin is wider, and a request without an answer in time is retried with the same `Idempotency-Key`, so it never sends twice.
   - declarations → directory internal pulls: 10 s. A page is up to 1,000 records; the pulls run in event consumers and workflow activities, which retry.
   - notifications → directory contact lookup: 1 s (`CONTACT_LOOKUP_TIMEOUT_MS`), shorter than the default, since it is spent from the messages API's own 5 s budget.

## Alternatives considered

| Option | Why not |
|---|---|
| Declarations reads contacts itself and sends by address | Puts personal contact data in a service that has no use for it, and every future sender (clarifications, notices, Form K) would repeat the lookup. |
| Notifications keeps its own copy of contacts, fed by events | Puts contacts in events, against ADR-013 §3 (events carry ids, not personal data). |
| Token exchange instead of the acting tenant header | No user token exists in consumers and workflows; ADR-013 §8.1 already names token exchange as the replacement once system work carries an originating user or tenant claim. |
| The 2 s default everywhere | A 1,000-record page and a provider with a 5 s budget cannot answer in 2 s; the calls would time out and retry forever. |

## Consequences

**Positive**
- Contacts stay in the directory and notifications; the declarations service holds person ids only.
- A slow directory or provider delays a reminder, never a user, and never sends one twice.

**Negative / risks**
- A reminder depends on three services being up at once; the activity's retries cover short outages, and the outcome is recorded as `failed` when they run out.
- The contacts cache can serve a contact changed less than 10 minutes ago.
