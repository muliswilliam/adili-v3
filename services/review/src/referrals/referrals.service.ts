import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { allocateReference, RFL } from '@adili/numbering';
import { and, desc, eq, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { reviewersOfRecord, requireCanApprove } from '../approvals/separation-of-duties.js';
import { caseTenant, queueTenant } from '../cases/access.js';
import { findCase, type ReviewTransaction, visibleId } from '../cases/case-lookup.js';
import { clarifications, reviewFlags } from '../cases/schema.js';
import { Clock, nairobiYear } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import type { ReasonInput } from '../determinations/determination-input.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { administrativeActions, enforcementLadders } from '../enforcement/schema.js';
import { withUpstream } from '../internal-api/upstream.js';
import { evidencePreview, planEvidence } from './evidence-package.js';
import {
  REFERRAL_APPROVED,
  REFERRAL_DECLINED,
  REFERRAL_PROPOSED,
  type ReferralApprovedData,
  type ReferralDeclinedData,
  type ReferralEventBase,
  type ReferralProposedData,
} from './events.js';
import type { ReferralInput, ReferralsQuery } from './referral-input.js';
import { ReferralWorkflows } from './referral-workflows.js';
import { referralView, type ReferralView } from './representation.js';
import { referrals, type ReferralStatus } from './schema.js';

type ReferralRow = typeof referrals.$inferSelect;

/**
 * The flags a reviewer's assets referral rests on (spec 08, r.20(1)(c)): the registry cross-checks
 * (spec 07b) and the comparisons with the previous declaration that point at undeclared or
 * unexplained assets. Completeness, lateness and the like are not grounds.
 */
export const ASSET_RULES: ReadonlySet<string> = new Set([
  'value-change-25',
  'acquisition-unflagged',
  'disposal-unflagged',
  'change-flag-mismatch',
  'income-vs-asset-growth',
  'nil-after-populated',
  'registry-parcel-undeclared',
  'declared-parcel-not-found',
  'registry-vehicle-undeclared',
  'declared-vehicle-not-found',
  'registry-directorship-undeclared',
  'declared-company-not-found',
  'directorship-employer-supplier',
]);

export interface ReferralPage {
  items: ReferralView[];
  nextCursor: string | null;
}

/**
 * Referrals to EACC (spec 08): the case's assignee proposes one on grounds of undeclared or
 * unexplained assets, selecting the supporting flags and clarifications; the referral sweep
 * proposes the others (`system`). A supervisor the separation-of-duties rule admits approves it
 * (allocating the `RFL` reference and starting the sending: evidence package, then
 * `referral.sent.v1`) or declines it with a note. The declarant is never told.
 */
@Injectable()
export class ReferralsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly directory: DirectoryClient,
    private readonly workflows: ReferralWorkflows,
    private readonly clock: Clock,
  ) {}

  async propose(principal: Principal, caseId: string, input: ReferralInput): Promise<ReferralView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const reviewCase = await findCase(tx, tenant, caseId, { lock: true });
      if (reviewCase.assignee !== principal.subject) {
        throw new ProblemException({
          type: 'not-the-assignee',
          title: 'Forbidden',
          status: HttpStatus.FORBIDDEN,
          detail: "Only the case's assignee can propose a referral from it.",
        });
      }
      const flagIds = unique(input.flagIds);
      const clarificationIds = unique(input.clarificationIds);
      const flags = await tx
        .select({ id: reviewFlags.id, ruleId: reviewFlags.ruleId })
        .from(reviewFlags)
        .where(and(inArray(reviewFlags.id, flagIds), eq(reviewFlags.caseId, reviewCase.id)));
      const invalidFlags = flagIds.filter(
        (id) => !flags.some((flag) => flag.id === id && ASSET_RULES.has(flag.ruleId)),
      );
      const issued =
        clarificationIds.length === 0
          ? []
          : await tx
              .select({ id: clarifications.id })
              .from(clarifications)
              .where(
                and(
                  inArray(clarifications.id, clarificationIds),
                  eq(clarifications.caseId, reviewCase.id),
                  ne(clarifications.status, 'draft'),
                ),
              );
      const invalidClarifications = clarificationIds.filter(
        (id) => !issued.some((found) => found.id === id),
      );
      if (invalidFlags.length > 0 || invalidClarifications.length > 0) {
        throw new ProblemException({
          type: 'about:blank',
          title: 'Validation failed',
          status: HttpStatus.BAD_REQUEST,
          errors: [
            ...invalidFlags.map((id) => ({
              path: 'flagIds',
              message: `${id} is not a registry or comparison flag of this case`,
            })),
            ...invalidClarifications.map((id) => ({
              path: 'clarificationIds',
              message: `${id} is not an issued clarification of this case`,
            })),
          ],
        });
      }
      const [open] = await tx
        .select({ id: referrals.id })
        .from(referrals)
        .where(and(eq(referrals.caseId, reviewCase.id), eq(referrals.status, 'proposed')));
      if (open) {
        throw new ProblemException(
          {
            type: 'referral-open',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail: 'A referral from this case already waits for approval.',
          },
          { code: 'referral-open', referralId: open.id },
        );
      }
      const [created] = await tx
        .insert(referrals)
        .values({
          id: uuidv7(),
          tenant,
          personId: reviewCase.personId,
          caseId: reviewCase.id,
          cycleYear: reviewCase.cycleYear,
          grounds: input.grounds,
          proposerKind: 'user',
          proposer: principal.subject,
          proposerName: principal.name,
          proposedAt: now,
          sources: {
            caseIds: [reviewCase.id],
            flagIds,
            clarificationIds,
            obligationIds: [],
            actionIds: await issuedActionsOf(tx, clarificationIds),
          },
          narrative: input.narrative,
          status: 'proposed',
          declarantName: reviewCase.declarantName,
          personnelFileNumber: reviewCase.personnelFileNumber,
        })
        .returning();
      const proposed = notFoundIfInvisible(created);
      await recordProposed(tx, this.events, proposed);
      return referralView(proposed);
    });
  }

  async list(principal: Principal, slug: string, query: ReferralsQuery): Promise<ReferralPage> {
    const tenant = queueTenant(principal, slug);
    const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(referrals)
        .where(
          and(
            eq(referrals.tenant, tenant),
            query.status === undefined ? undefined : eq(referrals.status, query.status),
            after === null
              ? undefined
              : or(
                  lt(referrals.proposedAt, after.proposedAt),
                  and(eq(referrals.proposedAt, after.proposedAt), lt(referrals.id, after.id)),
                ),
          ),
        )
        .orderBy(desc(referrals.proposedAt), desc(referrals.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => referralView(row)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ proposedAt: last.proposedAt, id: last.id })
            : null,
      };
    });
  }

  /** One referral with what its package includes (the preview before approval). */
  async get(principal: Principal, referralId: string): Promise<ReferralView> {
    const tenant = caseTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const [found] = await tx
        .select()
        .from(referrals)
        .where(and(eq(referrals.id, visibleId(referralId)), eq(referrals.tenant, tenant)));
      const referral = notFoundIfInvisible(found);
      return referralView(referral, evidencePreview(await planEvidence(tx, referral)));
    });
  }

  /**
   * A supervisor approves a proposal: the separation-of-duties rule first (403), then the status
   * (409). The `RFL` number is of the Commission and the year of approval; the directory is read
   * for the issuer code before anything changes, so an outage is a 503 and nothing is approved.
   * The sending (evidence package, `referral.sent.v1`) starts inside the transaction.
   */
  async approve(principal: Principal, referralId: string): Promise<ReferralView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const referral = await lockForDecision(tx, tenant, principal, referralId);
      requireProposed(referral.status);
      const commission = await withUpstream(() => this.directory.getCommission(tenant));
      const reference = await allocateReference(tx, RFL, {
        issuer: commission.issuerCode,
        period: nairobiYear(now),
      });
      const [updated] = await tx
        .update(referrals)
        .set({
          status: 'approved',
          approver: principal.subject,
          approverName: principal.name,
          approvedAt: now,
          reference,
        })
        .where(eq(referrals.id, referral.id))
        .returning();
      const approved = notFoundIfInvisible(updated);
      await this.events.record<ReferralApprovedData>(tx, {
        type: REFERRAL_APPROVED,
        subject: approved.id,
        tenant,
        data: { ...eventBase(approved), approver: principal.subject, reference },
      });
      // Last, inside the transaction: if Temporal cannot be reached nothing is approved. The
      // workflow's first activity waits for this transaction to commit.
      await this.workflows.startSending({ tenant, referralId: approved.id });
      return referralView(approved);
    });
  }

  /** A supervisor the rule admits declines a proposal with a note; nothing is sent. */
  async decline(
    principal: Principal,
    referralId: string,
    input: ReasonInput,
  ): Promise<ReferralView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const referral = await lockForDecision(tx, tenant, principal, referralId);
      requireProposed(referral.status);
      const [updated] = await tx
        .update(referrals)
        .set({
          status: 'declined',
          declinedBy: principal.subject,
          declinedByName: principal.name,
          declinedAt: now,
          declineNote: input.reason,
        })
        .where(eq(referrals.id, referral.id))
        .returning();
      const declined = notFoundIfInvisible(updated);
      await this.events.record<ReferralDeclinedData>(tx, {
        type: REFERRAL_DECLINED,
        subject: declined.id,
        tenant,
        data: { ...eventBase(declined), declinedBy: principal.subject },
      });
      return referralView(declined);
    });
  }
}

/** The identifiers every `referral.*` event carries. */
export function eventBase(row: ReferralRow): ReferralEventBase {
  return {
    referralId: row.id,
    tenant: row.tenant,
    grounds: row.grounds,
    cycleYear: row.cycleYear,
    personId: row.personId,
    proposerKind: row.proposerKind,
  };
}

/** `referral.proposed.v1` of a new proposal, an officer's or the sweep's. */
export async function recordProposed(
  tx: ReviewTransaction,
  events: EventPublisher,
  row: ReferralRow,
): Promise<void> {
  await events.record<ReferralProposedData>(tx, {
    type: REFERRAL_PROPOSED,
    subject: row.id,
    tenant: row.tenant,
    data: { ...eventBase(row), proposer: row.proposer },
  });
}

/**
 * The issued steps (their letters are evidence) of the ladders on the given subjects
 * (clarifications or obligations).
 */
export async function issuedActionsOf(
  tx: ReviewTransaction,
  subjectIds: readonly string[],
): Promise<string[]> {
  if (subjectIds.length === 0) return [];
  const rows = await tx
    .select({ id: administrativeActions.id })
    .from(administrativeActions)
    .innerJoin(enforcementLadders, eq(enforcementLadders.id, administrativeActions.ladderId))
    .where(
      and(
        inArray(enforcementLadders.subjectId, [...subjectIds]),
        isNotNull(administrativeActions.letterDocumentId),
      ),
    )
    .orderBy(sql`${administrativeActions.issuedAt} asc nulls last`, administrativeActions.id);
  return rows.map((row) => row.id);
}

/**
 * The referral of the tenant, locked, for a supervisor's decision; the separation-of-duties rule
 * applied to the caller (403): not its proposer, and not a reviewer of record of any case it rests
 * on.
 */
async function lockForDecision(
  tx: ReviewTransaction,
  tenant: string,
  principal: Principal,
  referralId: string,
): Promise<ReferralRow> {
  const [found] = await tx
    .select()
    .from(referrals)
    .where(and(eq(referrals.id, visibleId(referralId)), eq(referrals.tenant, tenant)))
    .for('update');
  const referral = notFoundIfInvisible(found);
  requireCanApprove(principal, {
    proposer: referral.proposer,
    reviewersOfRecord: mergedReviewers(await reviewersOfRecord(tx, referral.sources.caseIds)),
  });
  return referral;
}

/** Everyone who held any of the cases. */
export function mergedReviewers(byCase: Map<string, Set<string>>): Set<string> {
  return new Set([...byCase.values()].flatMap((subjects) => [...subjects]));
}

/** Approving and declining act on a proposal still waiting only. */
function requireProposed(status: ReferralStatus): void {
  if (status === 'proposed') return;
  throw new ProblemException(
    {
      type: 'not-proposed',
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail: `The referral is ${status}; it no longer waits for approval.`,
    },
    { code: 'not-proposed', referralStatus: status },
  );
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

interface ReferralPosition {
  proposedAt: Date;
  id: string;
}

const cursorPayload = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

/** Opaque to clients: base64url of `[proposedAt, id]`. */
function encodeCursor(position: ReferralPosition): string {
  return Buffer.from(JSON.stringify([position.proposedAt.toISOString(), position.id])).toString(
    'base64url',
  );
}

/** The position a cursor names; 400 for one this list did not issue. */
function decodeCursor(value: string): ReferralPosition {
  try {
    const parsed = cursorPayload.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (parsed.success) return { proposedAt: new Date(parsed.data[0]), id: parsed.data[1] };
  } catch {
    // Not JSON: not a cursor this list issued.
  }
  throw new ProblemException({
    type: 'about:blank',
    title: 'Bad Request',
    status: HttpStatus.BAD_REQUEST,
    detail: 'The cursor is not one this list issued.',
  });
}
