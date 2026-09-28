import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, ScheduleAlreadyRunning, ScheduleOverlapPolicy } from '@temporalio/client';
import { and, asc, inArray, isNull, lt, sql } from 'drizzle-orm';

import { config } from '../../config.js';
import type { DeclarationsSchema } from '../../db/schema.js';
import { PLATFORM_CONTEXT } from '../system-context.js';
import { filingObligations } from '../schema.js';
import { ObligationWorkflows } from '../workflows.js';
import { OBLIGATIONS_SWEEP_WORKFLOW } from './contract.js';
import type { obligationsSweep } from './workflows.js';

/** Obligations started per round of the sweep. */
const BATCH = 500;
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
const SCHEDULE_RETRY_MS = 60_000;

/**
 * The reconciliation sweep: starts the workflow of every open obligation that has none
 * (`workflow_started_at` null), the obligations whose start after commit was lost to a crash or a
 * Temporal outage. Round by round, oldest first; an obligation it cannot start ends the run
 * (thrown), to be tried again next hour.
 */
@Injectable()
export class ObligationsSweep {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly workflows: ObligationWorkflows,
  ) {}

  /** Returns how many workflows it started. */
  async run({
    graceMs = DEFAULT_GRACE_MS,
    progress = () => undefined,
  }: { graceMs?: number; progress?: (started: number) => void } = {}): Promise<number> {
    let started = 0;
    let previous: string | undefined;
    for (;;) {
      const rows = await withTenant(this.db, PLATFORM_CONTEXT, (tx) =>
        tx
          .select({ id: filingObligations.id, tenant: filingObligations.tenant })
          .from(filingObligations)
          .where(
            and(
              inArray(filingObligations.status, ['upcoming', 'due', 'overdue']),
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
}

/**
 * Keeps the Temporal schedule that runs the sweep hourly (`sweepScheduleId`). Created on
 * start-up if missing, retried every minute while Temporal is unreachable; an existing schedule is
 * left as it is.
 */
@Injectable()
export class SweepSchedule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SweepSchedule.name);
  private retry: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  onApplicationBootstrap(): void {
    void this.ensure();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.retry);
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
      if (error instanceof ScheduleAlreadyRunning) return;
      if (this.stopped) return;
      this.logger.warn({ err: error }, 'Obligations sweep schedule not created; retrying');
      this.retry = setTimeout(() => void this.ensure(), SCHEDULE_RETRY_MS);
    }
  }
}
