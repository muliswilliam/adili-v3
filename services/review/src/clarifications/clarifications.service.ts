import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { allocateReference, CLR } from '@adili/numbering';
import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  type CaseStatus,
  type ClarificationItem,
  clarificationResponses,
  clarifications,
  reviewCases,
  reviewTimeline,
} from '../cases/schema.js';
import { Clock, nairobiDate, nairobiYear } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import { requireAssignee, staffTenant } from './access.js';
import type { ClarificationInput } from './clarification-input.js';
import { ClarificationWorkflows } from './clarification-workflows.js';
import { type CaseStatusChangedData, REVIEW_CASE_STATUS_CHANGED } from '../cases/events.js';
import { CLARIFICATION_ISSUED, type ClarificationEventData } from './events.js';
import { clarificationView, type ClarificationView } from './representation.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The case status while the declarant has a clarification to answer. */
const AWAITING: CaseStatus = 'awaiting-clarification';

/**
 * Clarifications of review cases (spec 07a, Act s.35(2)-(4)): the assignee composes a draft and
 * issues it. Issuing allocates the `CLR` reference, sets the due date from the Commission's
 * policy, moves the case to `awaiting-clarification` and records the timeline entries and events
 * in one transaction, which also starts `ClarificationWorkflow` (letter, then notices).
 */
@Injectable()
export class ClarificationsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly directory: DirectoryClient,
    private readonly workflows: ClarificationWorkflows,
    private readonly clock: Clock,
  ) {}

  async createDraft(
    principal: Principal,
    caseId: string,
    input: ClarificationInput,
  ): Promise<ClarificationView> {
    const tenant = staffTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const [found] = await tx
        .select({ assignee: reviewCases.assignee, personId: reviewCases.personId })
        .from(reviewCases)
        .where(eq(reviewCases.id, caseId));
      const kase = notFoundIfInvisible(found);
      requireAssignee(principal, kase.assignee);
      const [created] = await tx
        .insert(clarifications)
        .values({
          id: uuidv7(),
          tenant,
          caseId,
          personId: kase.personId,
          status: 'draft',
          items: storedItems(input),
          createdBy: principal.subject,
        })
        .returning();
      return clarificationView(notFoundIfInvisible(created));
    });
  }

  async updateDraft(
    principal: Principal,
    clarificationId: string,
    input: ClarificationInput,
  ): Promise<ClarificationView> {
    const tenant = staffTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { clarification, kase } = await lockForWork(tx, clarificationId);
      requireAssignee(principal, kase.assignee);
      if (clarification.status !== 'draft') throw notADraft();
      const [updated] = await tx
        .update(clarifications)
        .set({ items: storedItems(input) })
        .where(eq(clarifications.id, clarificationId))
        .returning();
      return clarificationView(notFoundIfInvisible(updated));
    });
  }

  async get(principal: Principal, clarificationId: string): Promise<ClarificationView> {
    const tenant = staffTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const [found] = await tx
        .select()
        .from(clarifications)
        .where(eq(clarifications.id, clarificationId));
      const clarification = notFoundIfInvisible(found);
      const [response] = await tx
        .select()
        .from(clarificationResponses)
        .where(eq(clarificationResponses.clarificationId, clarificationId));
      return clarificationView(clarification, response ?? null);
    });
  }

  async issue(principal: Principal, clarificationId: string): Promise<ClarificationView> {
    const tenant = staffTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { clarification, kase } = await lockForWork(tx, clarificationId);
      requireAssignee(principal, kase.assignee);
      if (clarification.status !== 'draft') throw notADraft();
      if (clarification.items.length === 0) {
        throw new ProblemException(
          {
            type: 'clarification-has-no-items',
            title: 'Bad Request',
            status: HttpStatus.BAD_REQUEST,
            detail: 'A clarification needs at least one item to be issued.',
          },
          { code: 'clarification-has-no-items' },
        );
      }
      if (now > kase.windowEndsAt) {
        throw new ProblemException(
          {
            type: 'clarification-window-closed',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail: `The Commission could request clarification until ${nairobiDate(kase.windowEndsAt)}.`,
          },
          { code: 'clarification-window-closed', windowEndsAt: kase.windowEndsAt.toISOString() },
        );
      }

      const [policy, commission] = await Promise.all([
        withDirectory(() => this.directory.getClarificationPolicy(tenant)),
        withDirectory(() => this.directory.getCommission(tenant)),
      ]);
      const reference = await allocateReference(tx, CLR, {
        issuer: commission.issuerCode,
        period: nairobiYear(now),
      });
      const dueAt = new Date(now.getTime() + policy.replyWindowDays * DAY_MS);
      const [issued] = await tx
        .update(clarifications)
        .set({ status: 'issued', reference, issuedAt: now, dueAt })
        .where(eq(clarifications.id, clarificationId))
        .returning();
      await tx
        .update(reviewCases)
        .set({
          status: AWAITING,
          openClarifications: sql`${reviewCases.openClarifications} + 1`,
        })
        .where(eq(reviewCases.id, kase.id));

      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: kase.id,
        kind: 'clarification-issued',
        ref: clarificationId,
        actor: principal.subject,
        summary: `Clarification ${reference} issued, due ${nairobiDate(dueAt)}`,
      });
      await this.events.record<ClarificationEventData>(tx, {
        type: CLARIFICATION_ISSUED,
        subject: clarificationId,
        tenant,
        data: { clarificationId, caseId: kase.id },
      });
      if (kase.status !== AWAITING) {
        await tx.insert(reviewTimeline).values({
          id: uuidv7(),
          tenant,
          caseId: kase.id,
          kind: 'status-changed',
          ref: null,
          actor: principal.subject,
          summary: `Status changed from ${kase.status} to ${AWAITING}`,
        });
        await this.events.record<CaseStatusChangedData>(tx, {
          type: REVIEW_CASE_STATUS_CHANGED,
          subject: kase.id,
          tenant,
          data: { caseId: kase.id, from: kase.status, to: AWAITING },
        });
      }

      // Last, inside the transaction: if Temporal cannot be reached nothing is issued. The
      // workflow's first activity waits for this transaction to commit.
      await this.workflows.start({ tenant, clarificationId });
      return clarificationView(notFoundIfInvisible(issued));
    });
  }
}

type Transaction = Parameters<Parameters<Database<ReviewSchema>['transaction']>[0]>[0];

/** The clarification and its case, locked for the rest of the transaction; 404 when invisible. */
async function lockForWork(tx: Transaction, clarificationId: string) {
  const [found] = await tx
    .select()
    .from(clarifications)
    .where(eq(clarifications.id, clarificationId))
    .for('update');
  const clarification = notFoundIfInvisible(found);
  const [kase] = await tx
    .select({
      id: reviewCases.id,
      assignee: reviewCases.assignee,
      status: reviewCases.status,
      windowEndsAt: reviewCases.windowEndsAt,
    })
    .from(reviewCases)
    .where(eq(reviewCases.id, clarification.caseId))
    .for('update');
  return { clarification, kase: notFoundIfInvisible(kase) };
}

function storedItems(input: ClarificationInput): ClarificationItem[] {
  return input.items.map((item) => ({
    id: uuidv7(),
    sectionKey: item.sectionKey ?? null,
    personKey: item.personKey ?? null,
    itemId: item.itemId ?? null,
    requirement: item.requirement,
    text: item.text,
  }));
}

function notADraft(): ProblemException {
  return new ProblemException(
    {
      type: 'not-a-draft',
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail: 'The clarification has been issued; it can no longer be changed or issued.',
    },
    { code: 'not-a-draft' },
  );
}

/** A directory outage is a 503 the reviewer can retry; nothing has been issued. */
export async function withDirectory<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof DirectoryUnavailable)) throw error;
    throw new ProblemException({
      type: 'directory-unavailable',
      title: 'Service Unavailable',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      detail: 'The Commission directory cannot be reached. Try again shortly.',
    });
  }
}
