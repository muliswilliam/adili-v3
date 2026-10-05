import { randomUUID } from 'node:crypto';

import { switchTenant } from '@adili/data-access';
import type { EventEnvelope } from '@adili/events';
import { and, asc, eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

import {
  administrativeActions,
  enforcementLadders,
  type SubjectKind,
} from '../../src/enforcement/schema.js';
import type { Caller, ReviewApi } from './review-api.js';

/** `obligation.created.v1` (spec 04), as the RabbitMQ transport delivers it, announced at `time`. */
export function obligationCreatedEvent(
  tenant: string,
  obligation: { obligationId: string; rosterRecordId: string; cycleKey: string; dueDate: string },
  time: Date,
): EventEnvelope {
  return {
    specversion: '1.0',
    id: uuidv7(),
    source: 'adili/declarations',
    type: 'obligation.created.v1',
    time: time.toISOString(),
    subject: obligation.obligationId,
    datacontenttype: 'application/json',
    tenant,
    data: {
      obligationId: obligation.obligationId,
      rosterRecordId: obligation.rosterRecordId,
      type: 'biennial',
      cycleKey: obligation.cycleKey,
      statementDate: `${obligation.cycleKey.slice(-4)}-06-30`,
      dueDate: obligation.dueDate,
    },
  };
}

/** `obligation.status-changed.v1` (spec 04), as the RabbitMQ transport delivers it. */
export function obligationStatusChangedEvent(
  tenant: string,
  obligationId: string,
  from: string,
  to: string,
): EventEnvelope {
  return {
    specversion: '1.0',
    id: uuidv7(),
    source: 'adili/declarations',
    type: 'obligation.status-changed.v1',
    time: new Date().toISOString(),
    subject: obligationId,
    datacontenttype: 'application/json',
    tenant,
    data: { obligationId, from, to, reason: null },
  };
}

/** A `clarification.*` event of the review service, as the RabbitMQ transport delivers it. */
export function clarificationEvent(
  type: string,
  tenant: string,
  clarificationId: string,
  caseId: string,
): EventEnvelope {
  return {
    specversion: '1.0',
    id: uuidv7(),
    source: 'adili/review',
    type,
    time: new Date().toISOString(),
    subject: clarificationId,
    datacontenttype: 'application/json',
    tenant,
    data: { clarificationId, caseId },
  };
}

/**
 * The ladder of a subject and its actions, oldest first; null while there is none. Both are read
 * from one snapshot (repeatable read): under read committed, a workflow step committing between
 * the two reads (an action drafted and made the ladder's current one) would pair the ladder from
 * before with the actions from after.
 */
export async function ladderOf(api: ReviewApi, subjectKind: SubjectKind, subjectId: string) {
  return api.db.transaction(
    async (tx) => {
      await switchTenant(tx, { tenant: 'platform', subject: 'test' });
      const [ladder] = await tx
        .select()
        .from(enforcementLadders)
        .where(
          and(
            eq(enforcementLadders.subjectKind, subjectKind),
            eq(enforcementLadders.subjectId, subjectId),
          ),
        );
      if (!ladder) return null;
      const actions = await tx
        .select()
        .from(administrativeActions)
        .where(eq(administrativeActions.ladderId, ladder.id))
        .orderBy(asc(administrativeActions.proposedAt), asc(administrativeActions.createdAt));
      return { ladder, actions };
    },
    { isolationLevel: 'repeatable read' },
  );
}

type Ladder = NonNullable<Awaited<ReturnType<typeof ladderOf>>>;

/** Waits until the subject's ladder satisfies `ready` (the workflow runs on Temporal). */
export function ladderWhen(
  api: ReviewApi,
  subjectKind: SubjectKind,
  subjectId: string,
  ready: (found: Ladder) => boolean,
): Promise<Ladder> {
  return vi.waitFor(
    async () => {
      const found = await ladderOf(api, subjectKind, subjectId);
      if (!found || !ready(found)) throw new Error('ladder not there yet');
      return found;
    },
    { timeout: 45_000, interval: 250 },
  );
}

/** Approval of an action as `caller`, with an idempotency key. */
export function approveAction(api: ReviewApi, actionId: string, caller: Caller) {
  return api.send('POST', `/v1/review/actions/${actionId}/approve`, caller, undefined, {
    'idempotency-key': randomUUID(),
  });
}

/** Decline of an action as `caller`, with a note. */
export function declineAction(api: ReviewApi, actionId: string, caller: Caller, reason: string) {
  return api.send('POST', `/v1/review/actions/${actionId}/decline`, caller, { reason });
}
