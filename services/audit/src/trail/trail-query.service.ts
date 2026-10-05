import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { and, desc, eq, gte, like, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AuditSchema } from '../db/schema.js';
import type {
  AuditEventDetail,
  AuditEventPage,
  AuditEventSummary,
  ChainPage,
  ListChainsQuery,
  ListEventsQuery,
} from './representation.js';
import { auditAnchors, auditChainHeads, auditEvents } from './schema.js';

type EventRow = typeof auditEvents.$inferSelect;

/** Position after the last item of a page. Opaque to clients: base64url of `[occurredAt, id]`. */
const cursorPayload = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

function encodeCursor(row: Pick<EventRow, 'occurredAt' | 'eventId'>): string {
  return Buffer.from(JSON.stringify([row.occurredAt.toISOString(), row.eventId])).toString(
    'base64url',
  );
}

function decodeCursor(value: string): { occurredAt: Date; eventId: string } {
  try {
    const parsed = cursorPayload.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (parsed.success) return { occurredAt: new Date(parsed.data[0]), eventId: parsed.data[1] };
  } catch {
    // Falls through to the problem below.
  }
  throw new ProblemException({
    type: 'about:blank',
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    errors: [{ path: 'cursor', message: 'Unknown cursor; start again from the first page' }],
  });
}

/** An `action` filter: exact, or every action under a prefix ending in `.`. */
function actionFilter(action: string): SQL {
  if (!action.endsWith('.')) return eq(auditEvents.action, action);
  const escaped = action.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
  return like(auditEvents.action, `${escaped}%`);
}

function summaryOf(row: EventRow): AuditEventSummary {
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    kind: row.kind,
    action: row.action,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    tenant: row.tenant,
    actor: {
      type: row.actorType,
      id: row.actorId,
      clientId: row.actorClientId,
      tenant: row.actorTenant,
      roles: row.actorRoles,
      onBehalfOf: row.onBehalfOf,
    },
    resource: {
      type: row.resourceType,
      id: row.resourceId,
      subjectPersonId: row.subjectPersonId,
    },
    outcome: row.outcome,
    legalBasis:
      row.legalBasis === null ? null : { basis: row.legalBasis, reference: row.legalReference },
    recipient: row.recipient,
    source: row.source,
  };
}

/**
 * The audit trail's queries (ADR-008 "access to the audit trail is restricted to auditor and
 * investigator roles"): every tenant's events, newest first, and the chains with their anchors.
 * The controller admits auditors only; each of these reads is itself audited.
 */
@Injectable()
export class TrailQueryService {
  constructor(@InjectDatabase() private readonly db: Database<AuditSchema>) {}

  async list(query: ListEventsQuery): Promise<AuditEventPage> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const filters = [
      query.tenant && eq(auditEvents.tenant, query.tenant),
      query.actor && eq(auditEvents.actorId, query.actor),
      query.subjectPersonId && eq(auditEvents.subjectPersonId, query.subjectPersonId),
      query.resourceType && eq(auditEvents.resourceType, query.resourceType),
      query.resourceId && eq(auditEvents.resourceId, query.resourceId),
      query.action && actionFilter(query.action),
      query.kind && eq(auditEvents.kind, query.kind),
      query.from && gte(auditEvents.occurredAt, new Date(query.from)),
      query.to && lt(auditEvents.occurredAt, new Date(query.to)),
      after &&
        or(
          lt(auditEvents.occurredAt, after.occurredAt),
          and(eq(auditEvents.occurredAt, after.occurredAt), lt(auditEvents.eventId, after.eventId)),
        ),
    ].filter((each): each is SQL => Boolean(each));
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(and(...filters))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.eventId))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(summaryOf),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  async get(eventId: string): Promise<AuditEventDetail> {
    const [row] = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventId, eventId))
      .limit(1);
    const found = notFoundIfInvisible(row ?? null);
    return {
      ...summaryOf(found),
      request:
        found.requestMethod === null
          ? null
          : { method: found.requestMethod, route: found.requestRoute },
      traceparent: found.traceparent,
      data: found.envelope.data,
      chain: {
        chainDay: found.chainDay,
        seq: found.seq,
        hashVersion: found.hashV,
        prevHash: found.prevHash,
        hash: found.hash,
      },
    };
  }

  /** The chains of the days asked for, newest first, with their anchors once anchored. */
  async chains(query: ListChainsQuery): Promise<ChainPage> {
    const filters = [
      query.tenant && eq(auditChainHeads.tenant, query.tenant),
      query.from && gte(auditChainHeads.chainDay, query.from),
      query.to && lte(auditChainHeads.chainDay, query.to),
      // A head is created with the first event; one at 0 holds none.
      sql`${auditChainHeads.seq} > 0`,
    ].filter((each): each is SQL => Boolean(each));
    const rows = await this.db
      .select({
        tenant: auditChainHeads.tenant,
        chainDay: auditChainHeads.chainDay,
        seq: auditChainHeads.seq,
        headHash: auditChainHeads.headHash,
        merkleRoot: auditAnchors.merkleRoot,
        anchoredAt: auditAnchors.anchoredAt,
        objectKey: auditAnchors.objectKey,
      })
      .from(auditChainHeads)
      .leftJoin(
        auditAnchors,
        and(
          eq(auditAnchors.tenant, auditChainHeads.tenant),
          eq(auditAnchors.chainDay, auditChainHeads.chainDay),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(auditChainHeads.chainDay), auditChainHeads.tenant)
      .limit(query.limit);
    return {
      items: rows.map((row) => ({
        tenant: row.tenant,
        chainDay: row.chainDay,
        events: row.seq,
        headHash: row.headHash,
        anchor:
          row.merkleRoot === null || row.anchoredAt === null || row.objectKey === null
            ? null
            : {
                merkleRoot: row.merkleRoot,
                anchoredAt: row.anchoredAt.toISOString(),
                objectKey: row.objectKey,
              },
      })),
    };
  }
}
