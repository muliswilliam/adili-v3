import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE, withTenant } from '@adili/data-access';
import { ACCESS_OFFICER } from '@adili/roles';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { requireTransactionEnded } from '../activity-failures.js';
import { addDays, Clock, nairobiDate } from '../clock.js';
import { config } from '../config.js';
import type { AccessDatabase } from '../db/database.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { AccessRegister } from '../register/access-register.js';
import { systemContext } from '../system-context.js';
import {
  type AccessRequestWorkflowInput,
  IDENTIFY_REMINDER_DAY,
  type OfficerReminderOutcome,
  type OfficerReminderRequest,
  type RequestState,
  type ResolutionOutcome,
  type WindowOutcome,
} from './contract.js';
import { applicantRequestsUrl, declarantNoticesUrl, officerRequestUrl } from './links.js';
import type { AccessRequestRow } from './representation.js';
import { type AccessRequestStatus, accessRequests } from './schema.js';
import { CHANNELS, load, messageKey, send } from './workflow-support.js';

/** Statuses of a request waiting for the officer named in it to be resolved. */
const AWAITING_RESOLUTION: readonly AccessRequestStatus[] = ['submitted', 'officer-unresolved'];

/** Held for the access officer to verify a passport applicant. */
const HELD: AccessRequestStatus = 'pending-applicant-verification';

/** Statuses of a request waiting for the access officer's decision (or a step before it). */
const AWAITING_DECISION: readonly AccessRequestStatus[] = [
  HELD,
  ...AWAITING_RESOLUTION,
  'awaiting-representations',
  'under-decision',
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The activities of `AccessRequestWorkflow`, hosted by the access worker. Every public method is
 * an activity named after it (keep helpers out of this class: the worker registers every method
 * of the prototype); each is safe to retry, and reads the request before acting, so a late or
 * repeated run changes nothing twice. An unreachable database, directory or notifications
 * service propagates, so Temporal retries (activity-retry.ts); a message notifications refuses,
 * or cannot deliver, is logged and not retried.
 */
@Injectable()
export class AccessRequestActivities {
  private readonly logger = new Logger(AccessRequestActivities.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly directory: DirectoryClient,
    private readonly notifications: NotificationsClient,
    private readonly register: AccessRegister,
    private readonly clock: Clock,
  ) {}

  /**
   * Where the request stands (`RequestState`), once the transaction that received it has ended
   * (retried while it is open, activity-failures.ts): the workflow's first step, and its check
   * for lost signals while it waits.
   */
  async requestState({
    tenant,
    requestId,
    transactionId,
  }: AccessRequestWorkflowInput): Promise<RequestState> {
    await requireTransactionEnded(this.db, transactionId);
    const found = await load(this.db, tenant, requestId);
    return found ? stateOf(found) : 'missing';
  }

  /**
   * After the access officer resolved the officer named (S3). Resolved to a roster record: the
   * declarant is notified, once: the request becomes `awaiting-representations` with its window
   * (`REPRESENTATION_WINDOW_DAYS` from now), the `notified` register entry and its event; then
   * the declarant is told by email and SMS (a person recipient: notifications reads their
   * contacts from the directory), without who asked or why, which wait behind sign-in. Recorded
   * as unidentifiable: the applicant is told the request closed.
   */
  async resolution({ tenant, requestId }: AccessRequestWorkflowInput): Promise<ResolutionOutcome> {
    const found = await load(this.db, tenant, requestId);
    if (!found) return { outcome: 'missing' };
    if (found.status === 'cannot-identify') {
      for (const channel of CHANNELS) {
        await send(this.notifications, this.logger, found, {
          channel,
          recipient: { kind: 'person', personId: found.applicantPersonId },
          template: `access-decision-applicant-${channel}`,
          params: {
            reference: found.reference,
            commissionName: found.commissionName,
            outcome: 'cannot-identify',
            signInUrl: applicantRequestsUrl(),
          },
          tenant,
          idempotencyKey: messageKey(requestId, `cannot-identify:${channel}`),
        });
      }
      return { outcome: 'cannot-identify' };
    }
    if (found.status === 'withdrawn') return { outcome: 'withdrawn' };
    if (found.resolvedPersonId === null) return { outcome: 'unresolved' };

    const notified = await recordNotified(this.db, this.register, this.clock.now(), found);
    if (notified.status === 'withdrawn') return { outcome: 'withdrawn' };
    const { resolvedPersonId, windowEndsAt } = notified;
    if (resolvedPersonId === null || windowEndsAt === null) return { outcome: 'unresolved' };
    for (const channel of CHANNELS) {
      await send(this.notifications, this.logger, notified, {
        channel,
        recipient: { kind: 'person', personId: resolvedPersonId },
        template: `access-request-notified-${channel}`,
        params: {
          reference: notified.reference,
          commissionName: notified.commissionName,
          respondBy: nairobiDate(windowEndsAt),
          signInUrl: declarantNoticesUrl(),
        },
        tenant,
        idempotencyKey: messageKey(requestId, `notified:${channel}`),
      });
    }
    return { outcome: 'notified', windowEndsAt: windowEndsAt.toISOString() };
  }

  /**
   * At the end of the window for representations (S5): a request still
   * `awaiting-representations` goes `under-decision`. One the declarant consented on earlier is
   * there already; one withdrawn stays withdrawn.
   */
  async closeWindow({ tenant, requestId }: AccessRequestWorkflowInput): Promise<WindowOutcome> {
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const [closed] = await tx
        .update(accessRequests)
        .set({ status: 'under-decision' })
        .where(
          and(
            eq(accessRequests.id, requestId),
            eq(accessRequests.status, 'awaiting-representations'),
          ),
        )
        .returning({ id: accessRequests.id });
      if (closed) return 'under-decision';
      const [found] = await tx
        .select({ id: accessRequests.id })
        .from(accessRequests)
        .where(eq(accessRequests.id, requestId));
      return found ? 'unchanged' : 'missing';
    });
  }

  /**
   * Reminds the Commission's access officers by email (S5). Day five, while the officer named is
   * unidentified: to identify them (first verifying a passport applicant, for a held request),
   * and a request going ahead becomes `officer-unresolved`. Days twenty and twenty-eight, while
   * undecided: of the decision deadline, to verify the applicant, identify the officer or decide.
   * A decided or closed request, or one resolved by day five, gets none.
   */
  async remindOfficer({
    tenant,
    requestId,
    day,
  }: OfficerReminderRequest): Promise<OfficerReminderOutcome> {
    const found =
      day === IDENTIFY_REMINDER_DAY
        ? await markUnresolved(this.db, tenant, requestId)
        : await load(this.db, tenant, requestId);
    if (!found) return 'missing';
    const held = found.status === HELD;
    const unresolved = found.resolvedRosterRecordId === null;
    const waiting =
      day === IDENTIFY_REMINDER_DAY
        ? unresolved && (held || AWAITING_RESOLUTION.includes(found.status))
        : AWAITING_DECISION.includes(found.status);
    if (!waiting) return 'skipped';

    const now = this.clock.now();
    const daysLeft = Math.min(
      366,
      Math.max(0, Math.ceil((found.decisionDeadlineAt.getTime() - now.getTime()) / DAY_MS)),
    );
    const officers = await this.directory.staffWithRole(tenant, ACCESS_OFFICER);
    for (const officer of officers) {
      await send(this.notifications, this.logger, found, {
        channel: 'email',
        recipient: { kind: 'address', to: officer.email },
        template: 'access-officer-reminder-email',
        params: {
          reference: found.reference,
          commissionName: found.commissionName,
          task: held ? 'verify-applicant' : unresolved ? 'identify-officer' : 'decide',
          dueDate: nairobiDate(found.decisionDeadlineAt),
          daysLeft,
          signInUrl: officerRequestUrl(requestId),
        },
        tenant,
        idempotencyKey: messageKey(requestId, `officer-reminder:${String(day)}:${officer.subject}`),
      });
    }
    return 'sent';
  }
}

/** Where `row` stands, for the workflow (`RequestState`). */
function stateOf(row: AccessRequestRow): RequestState {
  switch (row.status) {
    case 'pending-applicant-verification':
      return 'held';
    case 'submitted':
    case 'officer-unresolved':
      return row.resolvedRosterRecordId === null ? 'unresolved' : 'resolved';
    case 'cannot-identify':
      return 'resolved';
    case 'awaiting-representations':
    case 'under-decision':
    case 'withdrawn':
      return row.status;
    case 'granted':
    case 'partially-granted':
    case 'denied':
      return 'decided';
  }
}

/** Day five: a request still `submitted` and unresolved is now `officer-unresolved`. */
async function markUnresolved(
  db: AccessDatabase,
  tenant: string,
  requestId: string,
): Promise<AccessRequestRow | undefined> {
  return withTenant(db, systemContext(tenant), async (tx) => {
    const [marked] = await tx
      .update(accessRequests)
      .set({ status: 'officer-unresolved' })
      .where(
        and(
          eq(accessRequests.id, requestId),
          eq(accessRequests.status, 'submitted'),
          isNull(accessRequests.resolvedRosterRecordId),
        ),
      )
      .returning();
    if (marked) return marked;
    const [found] = await tx.select().from(accessRequests).where(eq(accessRequests.id, requestId));
    return found;
  });
}

/**
 * Records the declarant's notification, once: the window opens `now`, with the `notified`
 * register entry and its event. A request notified already, or no longer waiting for it, is
 * returned as it is.
 */
async function recordNotified(
  db: AccessDatabase,
  register: AccessRegister,
  now: Date,
  found: AccessRequestRow,
): Promise<AccessRequestRow> {
  return withTenant(db, systemContext(found.tenant), async (tx) => {
    const windowEndsAt = addDays(now, config.REPRESENTATION_WINDOW_DAYS);
    const [updated] = await tx
      .update(accessRequests)
      .set({ status: 'awaiting-representations', notifiedAt: now, windowEndsAt })
      .where(
        and(
          eq(accessRequests.id, found.id),
          inArray(accessRequests.status, [...AWAITING_RESOLUTION]),
          isNull(accessRequests.notifiedAt),
        ),
      )
      .returning();
    if (!updated) {
      const [current] = await tx
        .select()
        .from(accessRequests)
        .where(eq(accessRequests.id, found.id));
      return current ?? found;
    }
    await register.record(tx, {
      tenant: updated.tenant,
      subjectKind: 'access-request',
      subjectId: updated.id,
      reference: updated.reference,
      personId: updated.resolvedPersonId,
      kind: 'notified',
      actor: null,
      at: now,
      details: { windowEndsAt: windowEndsAt.toISOString() },
      eventData: { windowEndsAt: windowEndsAt.toISOString() },
    });
    return updated;
  });
}
