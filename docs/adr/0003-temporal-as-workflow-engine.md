# ADR-003: Temporal as the workflow engine

- **Status:** Accepted; amended 2026-10-02: starting workflows with their transaction, recovering lost signals and final refusals (decision 7, spec 10)
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-001](0001-postgresql-as-sole-structured-data-store.md), [research/dials-scope-and-scale.md](../research/dials-scope-and-scale.md)

## Context

DIALs is driven by **statutory clocks** that run for days to years, across many actors and tenants:

| Clock / process | Rule |
|---|---|
| Initial declaration | Within 30 days of appointment (s.34(1)) |
| Biennial declaration | Statement date 1 Nov, file by 31 Dec in the declaration year (s.34(2)) |
| Final declaration | Within 30 days of leaving (s.34(3)) |
| Clarification | Commission may ask within 6 months of receipt; officer replies within 30 days (s.35(2)-(3)) |
| Non-compliance escalation | Notice to comply → warning → salary stoppage pending compliance → disciplinary proceedings (Admin Mechanisms, Aug 2026) |
| Referral to EACC | Failure to file or to answer a clarification for 2 consecutive cycles (Reg 20(2)) |
| Access request (Form K) | Notify declarant, allow representations, then decide (s.36(3), Reg 22) |
| Form M compliance report | Compile, approve, submit to EACC by 31 July (Reg 25(2)) |

Other forces:
- **~1.5M declarants** means ~1.8M filing obligations per cycle, each with reminders and escalations; ~160 tenants plus delegates.
- Timelines, reminder schedules and approval chains **differ by Commission and change with the law**. They must be configurable, not hard-coded.
- Processes call slow or unreliable external systems (KRA, NTSA, BRS, ArdhiSasa, IPRS, ICMS, payroll) and the self-hosted AI service. They need retries, timeouts and compensation.
- Every step must be auditable and survive restarts, deploys and data-centre failover.
- Self-hosted, open source, TypeScript-friendly (NestJS stack).

## Decision

1. **Temporal** (MIT licence, self-hosted) with the **TypeScript SDK**, persisted on **PostgreSQL** (its own database, per ADR-001). Temporal Web UI for operators.
2. **Temporal orchestrates; it is not the source of truth.** Domain state (declaration status, decisions, obligations) lives in each service's Postgres database. Workflows call service activities that write that state and emit audit records.
3. **Core workflows:**

| Workflow | Lifetime | Responsibility |
|---|---|---|
| `FilingObligationWorkflow` | Per officer per obligation | Reminders (staggered with jitter), due date, grace, escalation ladder, salary-stoppage request to payroll, 2-cycle referral |
| `DeclarationProcessingWorkflow` | Per submission | Acknowledgement → document extraction → integration checks → material-change and risk scoring → assign to reviewer |
| `ClarificationWorkflow` | Per request | 6-month issuing window, 30-day response timer, reminders, escalation on no response |
| `AccessRequestWorkflow` | Per Form K | Notify declarant, representation window, decision, notify applicant, time-boxed access grant |
| `ComplianceReportWorkflow` | Per Commission per period | Build Form M from data, internal approval, submit to EACC by 31 July |
| `NationalConsolidationWorkflow` | Per period (EACC) | Track Form M receipt from all Commissions, chase late filers, build national report, send non-compliant list to ICMS |

4. **Configuration as data:** statutory periods, reminder offsets, grace periods and approval chains live in versioned policy tables in the tenancy service, per tenant and category. Workflows read the policy version active when they start. That means a law or policy change creates a new version instead of a code change, and running cases stay reproducible.
5. **Scale practices:**
   - `continue-as-new` at cycle boundaries to keep histories short
   - Jitter on reminders and deadlines so ~1.5M timers don't fire in the same second
   - Task queues per domain, with horizontally scaled workers
   - **History shard count fixed at cluster creation** (plan 512+ for production; it can't be changed later)
6. **Roles vs the message queue:** Temporal owns long-running, stateful processes. RabbitMQ carries fire-and-forget domain events (audit fan-out, notifications, analytics) via the transactional outbox. Neither replaces the other.
7. **Starting, waiting and failing safely.** *Amended 2026-10-02 (spec 10).* The database is the source of truth (decision 2), and Temporal is not part of its transactions, so:
   - **Start inside the transaction, act after it ends.** A workflow is started inside the transaction that creates or changes its record, before that transaction takes any lock other transactions queue for (a reference counter), and is passed the transaction's id (`pg_current_xact_id()`). Temporal unreachable fails the start and rolls the transaction back, so a record never commits without its workflow (starting after commit would leave it without one whenever the process died in between). The first activity waits until that transaction has ended (`pg_xact_status`): committed means the record is real, rolled back ends the run at once, and it never reads an uncommitted record as missing or stale. No database lock is held across a Temporal call.
   - **Signals only save waiting.** A signal sent after commit can be lost (Temporal down for a moment, a failed call that is only logged). Every wait on a signal therefore also wakes on a timer and re-reads the record through an activity, so a lost signal delays a step by at most one interval and never stalls the run.
   - **Bounded retries, refusals final.** Activities retry transient failures (timeouts, 5xx, an unavailable dependency) with a bounded number of attempts. A refusal that no retry can change (a 4xx from a callee, a broken invariant) is raised as non-retryable (`ApplicationFailure.nonRetryable`), so the workflow handles it at once.

## Alternatives considered

| Option | Why not |
|---|---|
| **Camunda 8** | BPMN diagrams are attractive to business users, but since 8.6 self-managed production needs a paid Enterprise licence. Also Java plus Elasticsearch/OpenSearch to operate. |
| **Camunda 7 CE** | Community edition end of life; Java. |
| **Flowable** | Apache 2.0 BPMN engine and a real option, but Java-centric and embedded in a JVM service. Poor fit for a NestJS/TypeScript codebase. |
| **Netflix Conductor** | Netflix archived its repository; the community fork is maintained by a vendor. JSON workflow definitions, less type safety. |
| **Restate** | Modern durable execution, but BSL-licensed. |
| **BullMQ / cron + status columns** (hand-rolled) | Months-long timers, retries, escalation ladders and exactly-once semantics would be re-invented badly. Hard to audit and to scale. |
| **Workflow state in Postgres only (state machine library)** | Fine for simple status transitions, but no durable timers, retries or activity orchestration across services. We would still need a scheduler plus a queue. |

## Consequences

**Positive**
- Statutory deadlines become explicit, testable code with durable timers. The Temporal time-skipping test server lets us test "30 days later" in milliseconds.
- Survives restarts and failover without losing timers; full execution history per case helps auditors.
- One language (TypeScript) across services and workflows.
- Per-tenant, versioned policies handle ~160 Commissions and future legal changes.

**Negative / risks**
- **Another stateful platform** (Temporal server + its Postgres) to run, back up and monitor. It's in the DR plan.
- **Determinism discipline:** workflow code must be deterministic, and changes to running workflows need versioning (`patched`). Enforced by lint rules, replay tests in CI and code review.
- No business-friendly BPMN editor. Mitigation: generate process diagrams from code for documentation and the pitch, and show live cases in the Temporal UI.
- Shard count and persistence sizing must be decided before production (see Decision 5).

## Revisit when

- EACC mandates BPMN models editable by business users (reconsider Flowable as a separate process-modelling layer).
- Temporal's licence changes or the project loses active maintenance.
