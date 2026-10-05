import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { EventEnvelope } from '@adili/events';

/**
 * The audit trail (ADR-008): one row per event, append-only (triggers reject UPDATE, DELETE and
 * TRUNCATE, migration 0001), in one hash chain per tenant per UTC day. `seq` is the event's place
 * in its chain from 1; `hash` is SHA-256 of the previous event's hash and the canonical event
 * (`chain.ts`). The columns other than the chain's are read from `envelope` (`record.ts`) for
 * filtering; the verifier reads them again from it, so a changed column shows as tampering too.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    tenant: text().notNull(),
    chainDay: date({ mode: 'string' }).notNull(),
    seq: integer().notNull(),
    eventId: uuid().notNull(),
    eventType: text().notNull(),
    source: text().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    kind: text().$type<AuditKind>().notNull(),
    action: text().notNull(),
    actorType: text().$type<ActorType>().notNull(),
    actorId: text().notNull(),
    actorClientId: text(),
    actorTenant: text(),
    actorRoles: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    onBehalfOf: text(),
    resourceType: text().notNull(),
    resourceId: text(),
    subjectPersonId: text(),
    outcome: text().$type<AuditOutcome>().notNull(),
    legalBasis: text(),
    legalReference: text(),
    recipient: text(),
    requestMethod: text(),
    requestRoute: text(),
    traceparent: text(),
    envelope: jsonb().$type<EventEnvelope>().notNull(),
    hashV: smallint().notNull(),
    prevHash: text().notNull(),
    hash: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenant, table.chainDay, table.seq] }),
    uniqueIndex('audit_events_event_id_idx').on(table.eventId),
    index('audit_events_occurred_at_idx').on(table.occurredAt),
    index('audit_events_actor_idx').on(table.actorId, table.occurredAt),
    index('audit_events_subject_person_idx').on(table.subjectPersonId, table.occurredAt),
    index('audit_events_resource_idx').on(table.resourceType, table.resourceId),
    index('audit_events_action_idx').on(table.action, table.occurredAt),
    check('audit_events_seq_positive', sql`${table.seq} > 0`),
    check('audit_events_kind', sql`${table.kind} in ('read', 'write', 'verification', 'auth')`),
  ],
);

/**
 * The head of each tenant's chain of a day: its last `seq` and hash. The only row an append
 * changes, locked while it does, so a chain grows one event at a time.
 */
export const auditChainHeads = pgTable(
  'audit_chain_heads',
  {
    tenant: text().notNull(),
    chainDay: date({ mode: 'string' }).notNull(),
    seq: integer().notNull(),
    headHash: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenant, table.chainDay] })],
);

/**
 * The daily anchor of a chain (ADR-008 Pipeline step 5): the Merkle root of its event hashes,
 * signed with the OpenBao Transit key, archived in the `audit-archive` bucket. Append-only, like
 * the events.
 */
export const auditAnchors = pgTable(
  'audit_anchors',
  {
    tenant: text().notNull(),
    chainDay: date({ mode: 'string' }).notNull(),
    eventCount: integer().notNull(),
    headHash: text().notNull(),
    merkleRoot: text().notNull(),
    keyName: text().notNull(),
    keyVersion: integer().notNull(),
    /** Base64 Ed25519 signature of the anchor statement (`anchor.ts`). */
    signature: text().notNull(),
    objectKey: text().notNull(),
    anchoredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenant, table.chainDay] })],
);

export const AUDIT_KINDS = ['read', 'write', 'verification', 'auth'] as const;
/**
 * `read`: a read of sensitive data (`audit.read.v1`); `write`: a domain event, the record of the
 * change it was written with (ADR-008 Pipeline step 1); `verification`: a public verify lookup;
 * `auth`: sign-in facts (the demo role switch).
 */
export type AuditKind = (typeof AUDIT_KINDS)[number];

export const ACTOR_TYPES = ['user', 'service', 'system', 'anonymous'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const AUDIT_OUTCOMES = ['success', 'denied', 'error'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const trailSchema = { auditEvents, auditChainHeads, auditAnchors };
