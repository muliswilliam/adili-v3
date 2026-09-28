import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, ScheduleAlreadyRunning, ScheduleOverlapPolicy } from '@temporalio/client';

import { config } from '../../config.js';
import type { DeclarationsSchema } from '../../db/schema.js';
import { PLATFORM_CONTEXT } from '../system-context.js';
import { tenantPolicyCache } from '../schema.js';
import { CYCLE_OPENING_WORKFLOW, type CycleOpeningInput } from './contract.js';
import type { cycleOpening } from './workflows.js';

/**
 * One schedule per Commission and task queue (`declarations.cycle-opening.psc` in a deployment),
 * so a worker on another queue (a test suite, a second local checkout) never repoints the
 * deployment's schedules.
 */
export function cycleOpeningScheduleId(taskQueue: string, tenant: string): string {
  return `${taskQueue}.cycle-opening.${tenant}`;
}

/**
 * Keeps a Commission's cycle-opening schedule (ADR-003): created, idempotently, on its first roster
 * ingest. A Nest token so tests record the calls; `TemporalCycleOpeningSchedules` on Temporal.
 */
export abstract class CycleOpeningSchedules {
  /** Ensures the tenant's schedule exists. Failures are thrown; the caller logs them. */
  abstract ensure(tenant: string): Promise<void>;
}

const SCHEDULE_RETRY_MS = 60_000;

/**
 * The cycle-opening schedule of each Commission on Temporal. It fires daily just after midnight in
 * Nairobi, and at once when created; each firing runs `CycleOpeningWorkflow`, which opens the
 * cycles the calendar has opened by then and not yet for the Commission, and is a no-op otherwise.
 * A daily check rather than a timer at each opening date, so a change to the calendar (a cycle
 * opened early, a new cycle year) or to the Commission's statement date needs no schedule update,
 * and a firing missed while Temporal was down is made up the next day.
 *
 * Created on the Commission's first roster ingest, and on start-up for every Commission with a
 * roster (retried every minute while Temporal is unreachable). An existing schedule is left as it
 * is.
 */
@Injectable()
export class TemporalCycleOpeningSchedules
  extends CycleOpeningSchedules
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TemporalCycleOpeningSchedules.name);
  /** Tenants whose schedule is known to exist, so an ingest asks Temporal once per process. */
  private readonly ensured = new Set<string>();
  private retry: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    @InjectTemporalClient() private readonly temporal: Client,
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    void this.ensureAll();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.retry);
  }

  async ensure(tenant: string): Promise<void> {
    if (this.ensured.has(tenant)) return;
    const input: CycleOpeningInput = { tenant };
    try {
      await this.temporal.schedule.create<typeof cycleOpening>({
        scheduleId: cycleOpeningScheduleId(config.TEMPORAL_TASK_QUEUE, tenant),
        spec: { calendars: [{ hour: 0, minute: 15 }], timezone: 'Africa/Nairobi' },
        action: {
          type: 'startWorkflow',
          workflowType: CYCLE_OPENING_WORKFLOW,
          taskQueue: config.TEMPORAL_TASK_QUEUE,
          args: [input],
        },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
        state: { triggerImmediately: true },
      });
      this.logger.log({ tenant }, 'Created the cycle-opening schedule');
    } catch (error) {
      if (!(error instanceof ScheduleAlreadyRunning)) throw error;
    }
    this.ensured.add(tenant);
  }

  /** Every Commission with a roster ingested (a cached policy) has its schedule. */
  private async ensureAll(): Promise<void> {
    try {
      const tenants = await withTenant(this.db, PLATFORM_CONTEXT, (tx) =>
        tx.select({ tenant: tenantPolicyCache.tenant }).from(tenantPolicyCache),
      );
      for (const { tenant } of tenants) await this.ensure(tenant);
    } catch (error) {
      if (this.stopped) return;
      this.logger.warn({ err: error }, 'Cycle-opening schedules not ensured; retrying');
      this.retry = setTimeout(() => void this.ensureAll(), SCHEDULE_RETRY_MS);
    }
  }
}
