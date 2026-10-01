import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReviewTransaction } from '../cases/case-lookup.js';
import { changeCaseStatus } from '../cases/case-status.js';
import { reviewCases, reviewTimeline } from '../cases/schema.js';
import { Clock, nairobiDate } from '../clock.js';
import { config } from '../config.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { NotificationsClient } from '../notifications/notifications-client.js';
import { sendDecisionNotice } from '../determinations/activities.js';
import { DECISION_CHANNELS } from '../determinations/contract.js';
import { recordDetermination } from '../determinations/determinations.service.js';
import { DETERMINATION_PROPOSED } from '../determinations/events.js';
import { OUTCOME_LABELS } from '../determinations/representation.js';
import { determinations } from '../determinations/schema.js';
import { SYSTEM_SUBJECT, systemContext } from '../system-context.js';
import type {
  ClosureNoticesInput,
  ClosureSweepChunk,
  ClosureSweepCounts,
  ClosureSweepPlan,
  ClosureSweepRecord,
} from './contract.js';
import { eligibleForClosure } from './eligibility.js';
import { CLOSURE_SWEEP_COMPLETED, type ClosureSweepCompletedData } from './events.js';
import { inClosureSample } from './sampling.js';
import { closureSweeps } from './schema.js';

/** The reasons of every system closure proposal: why the system proposes it, not a finding. */
export const NO_ISSUES_REASONS =
  'Proposed by the system: low priority band, no open risk flags and no open clarification after the clarification window.';

/**
 * The activities of the bulk closure workflows (spec 08), hosted by the review worker. Every
 * public method is an activity named after it (keep helpers out of this class); each is safe to
 * retry: the sweep's chunks lock the cases they change and skip any another run holds, and a
 * sweep is recorded once by its id.
 */
@Injectable()
export class ClosureActivities {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    private readonly directory: DirectoryClient,
    private readonly notifications: NotificationsClient,
  ) {}

  /**
   * The Commissions' cycles with cases eligible now, read across tenants as the platform, with
   * the configured sample rate and the run's Nairobi date.
   */
  async closureSweepTargets(): Promise<ClosureSweepPlan> {
    const now = this.clock.now();
    const targets = await withTenant(
      this.db,
      { tenant: 'platform', subject: SYSTEM_SUBJECT },
      (tx) =>
        tx
          .selectDistinct({ tenant: reviewCases.tenant, cycleYear: reviewCases.cycleYear })
          .from(reviewCases)
          .where(eligibleForClosure(now))
          .orderBy(asc(reviewCases.tenant), asc(reviewCases.cycleYear)),
    );
    return { targets, sampleRate: config.CLOSURE_SAMPLE_RATE, runDate: nairobiDate(now) };
  }

  /**
   * One chunk of `BulkClosureSweep`: up to `limit` eligible cases of the Commission's cycle, locked
   * (skipping any another run holds), each either diverted to review (in the sample: status
   * `sample-review`, marked sampled, timeline) or given a `system` proposal `compliant-no-issues`
   * (timeline, `determination.proposed.v1`). One transaction; counts only in the result.
   */
  async sweepClosureChunk({
    tenant,
    cycleYear,
    sampleRate,
    limit,
  }: ClosureSweepChunk): Promise<ClosureSweepCounts> {
    const now = this.clock.now();
    return withTenant(this.db, systemContext(tenant), async (tx) => {
      const cases = await tx
        .select({ id: reviewCases.id, personId: reviewCases.personId, status: reviewCases.status })
        .from(reviewCases)
        .where(
          and(
            eq(reviewCases.tenant, tenant),
            eq(reviewCases.cycleYear, cycleYear),
            eligibleForClosure(now),
          ),
        )
        .orderBy(asc(reviewCases.receivedAt), asc(reviewCases.id))
        .limit(limit)
        .for('update', { skipLocked: true });
      const counts = { proposed: 0, sampled: 0 };
      for (const reviewCase of cases) {
        if (inClosureSample(reviewCase.id, cycleYear, sampleRate)) {
          await divert(tx, this.events, tenant, reviewCase, now);
          counts.sampled += 1;
        } else {
          await propose(tx, this.events, tenant, reviewCase, now);
          counts.proposed += 1;
        }
      }
      return counts;
    });
  }

  /** Records a finished sweep once, with `closure.sweep.completed.v1`. */
  async recordClosureSweep(record: ClosureSweepRecord): Promise<void> {
    const now = this.clock.now();
    await withTenant(this.db, systemContext(record.tenant), async (tx) => {
      const [inserted] = await tx
        .insert(closureSweeps)
        .values({
          id: record.sweepId,
          tenant: record.tenant,
          cycleYear: record.cycleYear,
          ranAt: now,
          sampleRate: record.sampleRate,
          proposed: record.proposed,
          sampled: record.sampled,
        })
        .onConflictDoNothing()
        .returning({ id: closureSweeps.id });
      if (!inserted) return;
      await this.events.record<ClosureSweepCompletedData>(tx, {
        type: CLOSURE_SWEEP_COMPLETED,
        subject: record.sweepId,
        tenant: record.tenant,
        data: {
          sweepId: record.sweepId,
          cycleYear: record.cycleYear,
          proposed: record.proposed,
          sampled: record.sampled,
          sampleRate: record.sampleRate,
        },
      });
    });
  }

  /**
   * Whether every closure of a bulk approval chunk is approved: its transaction started the
   * notices workflow, whose first activity can run before that transaction commits.
   */
  async closuresApproved({ tenant, determinationIds }: ClosureNoticesInput): Promise<boolean> {
    const [approved] = await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .select({ count: count() })
        .from(determinations)
        .where(
          and(inArray(determinations.id, determinationIds), eq(determinations.status, 'approved')),
        ),
    );
    return (approved?.count ?? 0) === determinationIds.length;
  }

  /**
   * Tells the declarants of a bulk approval chunk's closures of their decisions, by person, by
   * email and SMS, as an individual determination's are (`sendDecisionNotice`): a retry sends
   * nothing twice. No letter: a bulk closure's is issued when first asked for.
   */
  async notifyClosures({ tenant, determinationIds }: ClosureNoticesInput): Promise<number> {
    const approved = await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .select()
        .from(determinations)
        .where(
          and(inArray(determinations.id, determinationIds), eq(determinations.status, 'approved')),
        )
        .orderBy(asc(determinations.personId), asc(determinations.id)),
    );
    const commission = await this.directory.getCommission(tenant);
    for (const determination of approved) {
      for (const channel of DECISION_CHANNELS) {
        await sendDecisionNotice(this.notifications, determination, commission.name, channel);
      }
    }
    return approved.length;
  }
}

/** Diverts an eligible case to review: sampled, `sample-review`, back in the queue. */
async function divert(
  tx: ReviewTransaction,
  events: EventPublisher,
  tenant: string,
  reviewCase: { id: string; status: (typeof reviewCases.$inferSelect)['status'] },
  now: Date,
): Promise<void> {
  await tx.update(reviewCases).set({ sampledAt: now }).where(eq(reviewCases.id, reviewCase.id));
  await tx.insert(reviewTimeline).values({
    id: uuidv7(),
    tenant,
    caseId: reviewCase.id,
    kind: 'sampled-for-review',
    ref: null,
    actor: SYSTEM_SUBJECT,
    summary: 'Sampled for review by the bulk closure sweep instead of a system closure',
    at: now,
  });
  await changeCaseStatus(tx, events, {
    tenant,
    caseId: reviewCase.id,
    from: reviewCase.status,
    to: 'sample-review',
    actor: SYSTEM_SUBJECT,
    at: now,
  });
}

/** The system's `compliant-no-issues` proposal for an eligible case. */
async function propose(
  tx: ReviewTransaction,
  events: EventPublisher,
  tenant: string,
  reviewCase: { id: string; personId: string },
  now: Date,
): Promise<void> {
  const [created] = await tx
    .insert(determinations)
    .values({
      id: uuidv7(),
      tenant,
      caseId: reviewCase.id,
      personId: reviewCase.personId,
      outcome: 'compliant-no-issues',
      reasons: NO_ISSUES_REASONS,
      proposerKind: 'system',
      proposer: null,
      proposedAt: now,
      status: 'proposed',
    })
    .returning();
  if (!created) throw new Error(`The closure proposal of case ${reviewCase.id} was not stored`);
  await recordDetermination(tx, events, created, {
    kind: 'determination-proposed',
    type: DETERMINATION_PROPOSED,
    actor: SYSTEM_SUBJECT,
    summary: `Determination proposed by the system: ${OUTCOME_LABELS[created.outcome]}`,
    at: now,
  });
}
