import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, ScheduleAlreadyRunning, ScheduleOverlapPolicy } from '@temporalio/client';
import { and, asc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';

import { Clock } from '../../clock.js';
import { config } from '../../config.js';
import { StartupTask } from '../../startup-task.js';
import type { DeclarationsSchema } from '../../db/schema.js';
import { OPEN_STATUSES } from '../engine.js';
import { PLATFORM_CONTEXT, systemContext } from '../system-context.js';
import { reconcileSnapshots, storedReconcileContext } from '../apply-page.js';
import { nairobiDate } from '../dates.js';
import { filingObligations, rosterSnapshots } from '../schema.js';
import { ObligationWorkflows, type StoppedWorkflow } from '../workflows.js';
import { OBLIGATIONS_SWEEP_WORKFLOW, type SweepResult } from './contract.js';
import type { obligationsSweep } from './workflows.js';

/** Obligations started per round of the sweep. */
const BATCH = 500;
/**
 * Allowance for the Temporal server's clock against the database's: a stopped run that closed
 * up to this long after the obligation was last marked started is restarted (again) anyway.
 */
const CLOCK_SKEW_MS = 60_000;
/**
 * Obligations younger than this are left to the start that follows their commit, so the sweep
 * does not race it (harmless if it did: starts are idempotent).
 */
const DEFAULT_GRACE_MS = 60_000;

/**
 * One schedule per task queue (`declarations.obligations-sweep` in a deployment), so a worker on
 * another queue (a test suite, a second local checkout) never repoints the deployment's sweep.
 */
export function sweepScheduleId(taskQueue: string): string {
  return `${taskQueue}.obligations-sweep`;
}

/**
 * The reconciliation sweep (spec 04):
 *
 * - starts the workflow of every open obligation that has none (`workflow_started_at` null), the
 *   obligations whose start after commit was lost to a crash or a Temporal outage. Round by round,
 *   oldest first; an obligation it cannot start ends the run (thrown), to be tried again next hour;
 * - starts again the workflow of every open obligation whose run stopped without completing
 *   (failed, timed out, terminated or cancelled on Temporal), from Temporal's visibility. A stopped
 *   run that closed before the obligation was last marked started has been restarted already;
 *   a completed run is never run again (the start's reuse policy);
 * - cancels the `upcoming` obligations of exited declarants that the engine no longer owes (a
 *   reconciliation lost between an exit and its obligations), and signals their workflows. It
 *   creates nothing: finals come with the exit's own ingest.
 */
@Injectable()
export class ObligationsSweep {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    @Inject(EventPublisher) private readonly events: EventPublisher,
    private readonly workflows: ObligationWorkflows,
    private readonly clock: Clock,
  ) {}

  async run({
    graceMs = DEFAULT_GRACE_MS,
    progress = () => undefined,
  }: { graceMs?: number; progress?: (done: number) => void } = {}): Promise<SweepResult> {
    const started = await this.startMissing(graceMs, progress);
    const restarted = await this.restartStopped((done) => {
      progress(started + done);
    });
    const cancelled = await this.cancelExited((done) => {
      progress(started + restarted + done);
    });
    return { started, restarted, cancelled };
  }

  private async startMissing(
    graceMs: number,
    progress: (started: number) => void,
  ): Promise<number> {
    let started = 0;
    let previous: string | undefined;
    for (;;) {
      const rows = await withTenant(this.db, PLATFORM_CONTEXT, (tx) =>
        tx
          .select({ id: filingObligations.id, tenant: filingObligations.tenant })
          .from(filingObligations)
          .where(
            and(
              inArray(filingObligations.status, [...OPEN_STATUSES]),
              isNull(filingObligations.workflowStartedAt),
              lt(
                filingObligations.createdAt,
                sql`now() - make_interval(secs => ${graceMs / 1000})`,
              ),
            ),
          )
          .orderBy(asc(filingObligations.createdAt), asc(filingObligations.id))
          .limit(BATCH),
      );
      // The same round again means the starts were not recorded: stop rather than spin.
      if (rows.length === 0 || rows[0]?.id === previous) return started;
      previous = rows[0]?.id;
      for (const [tenant, group] of Map.groupBy(rows, (row) => row.tenant)) {
        await this.workflows.apply(tenant, {
          created: group.map((row) => row.id),
          cancelled: [],
          personLinked: [],
        });
      }
      started += rows.length;
      progress(started);
      if (rows.length < BATCH) return started;
    }
  }

  /**
   * Pages through the stopped runs Temporal lists, and starts again those whose obligation is
   * still open and was not started since the run closed, one tenant at a time.
   */
  private async restartStopped(progress: (restarted: number) => void): Promise<number> {
    let restarted = 0;
    for await (const page of pages(this.workflows.stopped(), BATCH)) {
      // An obligation's latest stopped run is the one that counts.
      const closedAt = new Map<string, number>();
      for (const { obligationId, closedAt: at } of page) {
        closedAt.set(obligationId, Math.max(at.getTime(), closedAt.get(obligationId) ?? 0));
      }
      const rows = await withTenant(this.db, PLATFORM_CONTEXT, (tx) =>
        tx
          .select({
            id: filingObligations.id,
            tenant: filingObligations.tenant,
            workflowStartedAt: filingObligations.workflowStartedAt,
          })
          .from(filingObligations)
          .where(
            and(
              inArray(filingObligations.id, [...closedAt.keys()]),
              inArray(filingObligations.status, [...OPEN_STATUSES]),
            ),
          ),
      );
      const stopped = rows.filter(
        (row) =>
          row.workflowStartedAt === null ||
          row.workflowStartedAt.getTime() < (closedAt.get(row.id) ?? 0) + CLOCK_SKEW_MS,
      );
      for (const [tenant, group] of Map.groupBy(stopped, (row) => row.tenant)) {
        await this.workflows.apply(tenant, {
          created: group.map((row) => row.id),
          cancelled: [],
          personLinked: [],
        });
      }
      restarted += stopped.length;
      progress(restarted);
    }
    return restarted;
  }

  /**
   * Pages through the exited declarants that still have an upcoming obligation, by roster record
   * id, and lets the engine cancel what they no longer owe, one tenant at a time.
   */
  private async cancelExited(progress: (cancelled: number) => void): Promise<number> {
    const today = nairobiDate(this.clock.now());
    let cancelled = 0;
    let after: string | undefined;
    for (;;) {
      const rows = await withTenant(this.db, PLATFORM_CONTEXT, (tx) =>
        tx
          .selectDistinct({
            rosterRecordId: rosterSnapshots.rosterRecordId,
            tenant: rosterSnapshots.tenant,
          })
          .from(rosterSnapshots)
          .innerJoin(
            filingObligations,
            eq(filingObligations.rosterRecordId, rosterSnapshots.rosterRecordId),
          )
          .where(
            and(
              eq(rosterSnapshots.state, 'exited'),
              eq(filingObligations.status, 'upcoming'),
              after === undefined ? undefined : gt(rosterSnapshots.rosterRecordId, after),
            ),
          )
          .orderBy(asc(rosterSnapshots.rosterRecordId))
          .limit(BATCH),
      );
      for (const [tenant, group] of Map.groupBy(rows, (row) => row.tenant)) {
        const changes = await withTenant(this.db, systemContext(tenant), async (tx) => {
          const context = await storedReconcileContext(tx, tenant, today);
          if (!context) return null;
          return reconcileSnapshots(
            tx,
            this.events,
            context,
            group.map((row) => row.rosterRecordId),
            (operation) => operation.kind === 'cancel',
          );
        });
        if (!changes || changes.cancelled.length === 0) continue;
        cancelled += changes.cancelled.length;
        await this.workflows.apply(tenant, changes);
      }
      progress(cancelled);
      after = rows.at(-1)?.rosterRecordId;
      if (rows.length < BATCH) return cancelled;
    }
  }
}

/** `items` in arrays of up to `size`. */
async function* pages(
  items: AsyncIterable<StoppedWorkflow>,
  size: number,
): AsyncIterable<StoppedWorkflow[]> {
  let page: StoppedWorkflow[] = [];
  for await (const item of items) {
    page.push(item);
    if (page.length === size) {
      yield page;
      page = [];
    }
  }
  if (page.length > 0) yield page;
}

/**
 * Keeps the Temporal schedule that runs the sweep hourly (`sweepScheduleId`). Created on
 * start-up if missing, retried every minute while Temporal is unreachable; an existing schedule is
 * left as it is.
 */
@Injectable()
export class SweepSchedule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SweepSchedule.name);
  private readonly task = new StartupTask(
    this.logger,
    'Obligations sweep schedule not created',
    () => this.ensure(),
  );

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  onApplicationBootstrap(): void {
    this.task.start();
  }

  onApplicationShutdown(): void {
    this.task.stop();
  }

  private async ensure(): Promise<void> {
    try {
      await this.temporal.schedule.create<typeof obligationsSweep>({
        scheduleId: sweepScheduleId(config.TEMPORAL_TASK_QUEUE),
        spec: { intervals: [{ every: '1 hour' }] },
        action: {
          type: 'startWorkflow',
          workflowType: OBLIGATIONS_SWEEP_WORKFLOW,
          taskQueue: config.TEMPORAL_TASK_QUEUE,
          args: [],
        },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
      });
      this.logger.log('Created the hourly obligations sweep schedule');
    } catch (error) {
      if (!(error instanceof ScheduleAlreadyRunning)) throw error;
    }
  }
}
