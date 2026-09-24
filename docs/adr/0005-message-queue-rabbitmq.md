# ADR-005: Message queue - RabbitMQ with transactional outbox

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Adili V3 DIALs team
- **Related:** [ADR-001](0001-postgresql-as-sole-structured-data-store.md), [ADR-003](0003-temporal-as-workflow-engine.md), [ADR-008](0008-audit-trail.md)

## Context

Microservices need asynchronous, reliable events for:
- audit fan-out
- notifications
- document scanning and AI extraction
- integration lookups
- analytics and read models

Estimated load: ~20 domain events per declaration plus audit events, about **1.5k msg/s at nominal peak** and **~9k msg/s in the stress case** (see research/database-sizing.md). Every event about a legal record must be delivered exactly once from the business point of view: never lost, never duplicated in effect. Self-hosted, open source, first-class NestJS support.

## Decision

1. **RabbitMQ** (MPL 2.0) with **quorum queues** (Raft-replicated, durable). 3-node cluster in production.
2. **Transactional outbox in every service:** an event is inserted into the service's `outbox` table in the **same transaction** as the state change. A relay publishes it and marks it sent. No state change without its event, and no event without its state change.
3. **Idempotent consumers:** an `inbox` table of processed message IDs per consumer. Delivery is at-least-once, with exactly-once effect.
4. **Envelope:** CloudEvents 1.0 JSON, with `id` (UUIDv7), `type` (e.g. `ke.eacc.dials.declaration.submitted.v1`), `source`, `time`, `tenantid`, `correlationid` and `traceparent`. Payload schemas are versioned and documented in **AsyncAPI**. No financial values in event payloads, only IDs; consumers fetch what they are authorised to see.
5. **Topology:** topic exchanges per domain. Routing keys like `declaration.submitted.v1`. One queue per consumer service.
6. **Failure handling:**
   - Retries with increasing delay (1m, 5m, 30m, 2h), then a **dead-letter queue** with alerts.
   - An operator view to inspect and replay dead-lettered messages.
   - Per-aggregate ordering where needed (single active consumer or consistent-hash exchange).
7. **Division of labour:**
   - **Temporal** (ADR-003) owns long-running, stateful processes with deadlines.
   - **RabbitMQ** carries one-way domain events.
   - Neither replaces the other.
8. **External systems do not connect to RabbitMQ.** Commissions and employers integrate through the public REST API and signed webhooks (ADR-009).

## Alternatives considered

| Option | Why not |
|---|---|
| Apache Kafka | Event log with replay; heavy to operate, and more than our needs. |
| Redpanda | Kafka-compatible and lighter, but BSL licence (not open source). |
| NATS JetStream | Light and fast; weaker NestJS support and a smaller operations ecosystem in the region. |
| Valkey Streams | Valkey is our cache; mixing durable messaging into it weakens both. |
| BullMQ | Job queue, not an event bus; no fan-out topology. |
| Direct HTTP calls between services | Tight coupling, cascading failures, no buffering for deadline bursts. |

## Consequences

**Positive**
- Reliable, decoupled services; deadline bursts are buffered.
- Built-in NestJS microservice transport, and a mature management UI.
- The outbox guarantees audit completeness (ADR-008).

**Negative / risks**
- The outbox relay and inbox tables add code to every service. Mitigation: build them once in a shared library.
- Quorum queues need 3 nodes and disk monitoring (in the HA/DR plan).
- Schema evolution discipline: additive changes only within a version; a breaking change gets a new `.vN` event type.
