import { TENANT_KEY } from '@adili/api-kit';
import { z } from 'zod';

import { CHAIN_PROBLEMS } from './verifier.js';
import { ACTOR_TYPES, AUDIT_KINDS, AUDIT_OUTCOMES } from './schema.js';

/** A tenant key: a Commission slug, `eacc`, `lea` or `platform`. */
const tenantKey = z.string().regex(TENANT_KEY);

export const auditEventSummarySchema = z
  .object({
    eventId: z.uuid(),
    eventType: z.string().meta({ description: 'The event type filed, e.g. `audit.read.v1`' }),
    kind: z.enum(AUDIT_KINDS).meta({
      description:
        '`read`: a read of sensitive data; `write`: a change, recorded by its domain event; `verification`: a public verify lookup; `auth`: a sign-in fact (the demo role switch)',
    }),
    action: z.string().meta({ description: 'e.g. `declaration.submitted`, `review.case.viewed`' }),
    occurredAt: z.iso.datetime({ offset: true }),
    recordedAt: z.iso.datetime({ offset: true }),
    tenant: z.string().meta({
      description: 'The tenant whose chain holds the event: the data it is about, else `platform`',
    }),
    actor: z.object({
      type: z.enum(ACTOR_TYPES),
      id: z.string().meta({
        description:
          'Token `sub` of a user or service account, the producing service (`adili/<service>`) for a write, or the coarse network of an anonymous verify lookup',
      }),
      clientId: z.string().nullable(),
      tenant: z.string().nullable(),
      roles: z.array(z.string()),
      onBehalfOf: z.string().nullable(),
    }),
    resource: z.object({
      type: z.string(),
      id: z
        .string()
        .nullable()
        .meta({ description: 'Comma-separated when a batch read served several' }),
      subjectPersonId: z.string().nullable(),
    }),
    outcome: z.enum(AUDIT_OUTCOMES),
    legalBasis: z.object({ basis: z.string(), reference: z.string().nullable() }).nullable().meta({
      description: 'Why the data was read (ADR-008 `legal_basis`), when the read named it',
    }),
    recipient: z.string().nullable(),
    source: z.string().meta({ description: 'Producing service, e.g. `adili/declarations`' }),
  })
  .meta({ description: 'One event of the audit trail' });

export const auditEventPageSchema = z.object({
  items: z.array(auditEventSummarySchema),
  nextCursor: z.string().nullable().meta({ description: 'Null on the last page' }),
});

export const auditEventSchema = auditEventSummarySchema.extend({
  request: z
    .object({ method: z.string(), route: z.string().nullable() })
    .nullable()
    .meta({ description: 'The route an audited read was served on' }),
  traceparent: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).meta({
    description: "The event's data as published: identifiers and non-sensitive facts only",
  }),
  chain: z.object({
    chainDay: z.iso.date(),
    seq: z.int().min(1),
    hashVersion: z.int(),
    prevHash: z.string(),
    hash: z.string(),
  }),
});

export const chainSummarySchema = z.object({
  tenant: z.string(),
  chainDay: z.iso.date(),
  events: z.int().min(0),
  headHash: z.string(),
  anchor: z
    .object({
      merkleRoot: z.string(),
      anchoredAt: z.iso.datetime({ offset: true }),
      objectKey: z.string(),
    })
    .nullable()
    .meta({ description: 'Null until the day has ended and the anchoring ran' }),
});

export const chainPageSchema = z.object({ items: z.array(chainSummarySchema) });

export const chainVerificationSchema = z.object({
  tenant: z.string(),
  chainDay: z.iso.date(),
  events: z.int().min(0),
  status: z.enum(['intact', 'tampered']),
  problems: z.array(
    z.object({
      kind: z.enum(CHAIN_PROBLEMS),
      seq: z
        .int()
        .nullable()
        .meta({ description: 'The event at fault; null for the head or anchor' }),
    }),
  ),
  anchor: z.object({
    status: z.enum(['none', 'matches', 'mismatch']),
    anchoredAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  merkleRoot: z.string().nullable(),
});

export type AuditEventSummary = z.infer<typeof auditEventSummarySchema>;
export type AuditEventPage = z.infer<typeof auditEventPageSchema>;
export type AuditEventDetail = z.infer<typeof auditEventSchema>;
export type ChainSummary = z.infer<typeof chainSummarySchema>;
export type ChainPage = z.infer<typeof chainPageSchema>;

const blankToUndefined = (value: string | undefined) => (value === '' ? undefined : value);

/** Query of `GET /v1/audit/events`. */
export const listEventsQuery = z.object({
  tenant: tenantKey.optional().meta({ description: 'Only the chain of this tenant' }),
  actor: z.string().trim().max(200).optional().transform(blankToUndefined).meta({
    description: 'Actor id (token `sub`, service or network), exact',
  }),
  subjectPersonId: z.uuid().optional().meta({ description: 'The person the data is about' }),
  resourceType: z.string().trim().max(100).optional().transform(blankToUndefined),
  resourceId: z.string().trim().max(200).optional().transform(blankToUndefined),
  action: z.string().trim().max(200).optional().transform(blankToUndefined).meta({
    description: 'Exact action, or a prefix ending in `.` (`declaration.`)',
  }),
  kind: z.enum(AUDIT_KINDS).optional(),
  from: z.iso.datetime({ offset: true }).optional().meta({ description: 'Occurred at or after' }),
  to: z.iso.datetime({ offset: true }).optional().meta({ description: 'Occurred before' }),
  cursor: z
    .string()
    .max(500)
    .optional()
    .meta({ description: '`nextCursor` of the previous page; omit for the first page' }),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListEventsQuery = z.infer<typeof listEventsQuery>;

/** Query of `GET /v1/audit/chains`. */
export const listChainsQuery = z.object({
  tenant: tenantKey.optional(),
  from: z.iso.date().optional().meta({ description: 'First chain day' }),
  to: z.iso.date().optional().meta({ description: 'Last chain day' }),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type ListChainsQuery = z.infer<typeof listChainsQuery>;
