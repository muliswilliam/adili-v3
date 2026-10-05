import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { and, asc, eq, gt } from 'drizzle-orm';

import type { AuditSchema } from '../db/schema.js';
import { chainDayOf, eventHash, GENESIS_HASH, merkleRoot } from './chain.js';
import { type AuditRecord, recordOf } from './record.js';
import { auditAnchors, auditChainHeads, auditEvents } from './schema.js';

export const CHAIN_PROBLEMS = [
  'missing-event',
  'broken-link',
  'hash-mismatch',
  'record-mismatch',
  'head-mismatch',
  'anchor-mismatch',
] as const;
export type ChainProblemKind = (typeof CHAIN_PROBLEMS)[number];

export interface ChainProblem {
  kind: ChainProblemKind;
  /** The event at fault; null for the chain as a whole (its head or anchor). */
  seq: number | null;
}

export interface ChainVerification {
  tenant: string;
  chainDay: string;
  events: number;
  status: 'intact' | 'tampered';
  problems: ChainProblem[];
  /** The chain's anchor: none yet, or whether its root and head still match the events. */
  anchor: { status: 'none' | 'matches' | 'mismatch'; anchoredAt: string | null };
  /** The Merkle root of the events as they are now; null for a chain without events. */
  merkleRoot: string | null;
}

/** Rows read at a time, so a busy day's chain is never held in one query. */
const PAGE = 5_000;

/** The record columns the verifier reads again from each envelope. */
const RECORD_KEYS = [
  'tenant',
  'kind',
  'action',
  'actorType',
  'actorId',
  'actorClientId',
  'actorTenant',
  'actorRoles',
  'onBehalfOf',
  'resourceType',
  'resourceId',
  'subjectPersonId',
  'outcome',
  'legalBasis',
  'legalReference',
  'recipient',
  'requestMethod',
  'requestRoute',
  'traceparent',
] as const satisfies readonly (keyof AuditRecord)[];

/**
 * Recomputes a chain (ADR-008 Pipeline step 6): every event in order from 1, each linking to the
 * hash before it, each hash recomputed from its envelope and position, each filtered column read
 * again from the envelope, the head at the last event, and the anchor's root and head, if
 * anchored, matching the events as they are now. Any difference is tampering.
 */
@Injectable()
export class ChainVerifier {
  constructor(@InjectDatabase() private readonly db: Database<AuditSchema>) {}

  async verify(tenant: string, chainDay: string): Promise<ChainVerification> {
    const problems: ChainProblem[] = [];
    const hashes: string[] = [];
    let expectedSeq = 1;
    let prevHash = GENESIS_HASH;
    for (;;) {
      const rows = await this.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.tenant, tenant),
            eq(auditEvents.chainDay, chainDay),
            gt(auditEvents.seq, expectedSeq - 1),
          ),
        )
        .orderBy(asc(auditEvents.seq))
        .limit(PAGE);
      for (const row of rows) {
        if (row.seq !== expectedSeq) {
          problems.push({ kind: 'missing-event', seq: expectedSeq });
        }
        if (row.prevHash !== prevHash) problems.push({ kind: 'broken-link', seq: row.seq });
        const recomputed = eventHash(
          row.prevHash,
          { tenant: row.tenant, chainDay: row.chainDay, seq: row.seq },
          row.envelope,
          row.hashV,
        );
        if (recomputed !== row.hash) problems.push({ kind: 'hash-mismatch', seq: row.seq });
        const record = recordOf(row.envelope);
        const stored = row as unknown as Record<string, unknown>;
        if (
          row.eventId !== row.envelope.id ||
          row.eventType !== row.envelope.type ||
          row.source !== row.envelope.source ||
          row.occurredAt.getTime() !== new Date(row.envelope.time).getTime() ||
          // An event joins the chain of the day it is recorded on.
          chainDayOf(row.recordedAt) !== row.chainDay ||
          RECORD_KEYS.some((key) => !sameValue(record[key], stored[key]))
        ) {
          problems.push({ kind: 'record-mismatch', seq: row.seq });
        }
        hashes.push(row.hash);
        prevHash = row.hash;
        expectedSeq = row.seq + 1;
      }
      if (rows.length < PAGE) break;
    }

    const [head] = await this.db
      .select()
      .from(auditChainHeads)
      .where(and(eq(auditChainHeads.tenant, tenant), eq(auditChainHeads.chainDay, chainDay)));
    const lastSeq = expectedSeq - 1;
    if (head && (head.seq !== lastSeq || head.headHash !== prevHash)) {
      // Events after the last one left, or the last ones removed.
      problems.push({ kind: head.seq > lastSeq ? 'missing-event' : 'head-mismatch', seq: null });
    }

    const root = hashes.length > 0 ? merkleRoot(hashes) : null;
    const [anchor] = await this.db
      .select()
      .from(auditAnchors)
      .where(and(eq(auditAnchors.tenant, tenant), eq(auditAnchors.chainDay, chainDay)));
    let anchorStatus: ChainVerification['anchor']['status'] = 'none';
    if (anchor) {
      const matches =
        anchor.merkleRoot === root &&
        anchor.eventCount === hashes.length &&
        anchor.headHash === prevHash;
      anchorStatus = matches ? 'matches' : 'mismatch';
      if (!matches) problems.push({ kind: 'anchor-mismatch', seq: null });
    }

    return {
      tenant,
      chainDay,
      events: hashes.length,
      status: problems.length === 0 ? 'intact' : 'tampered',
      problems,
      anchor: { status: anchorStatus, anchoredAt: anchor?.anchoredAt.toISOString() ?? null },
      merkleRoot: root,
    };
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, at) => item === b[at]);
  }
  return (a ?? null) === (b ?? null);
}
