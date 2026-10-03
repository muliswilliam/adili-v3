import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDatabase } from '@adili/data-access';
import { and, asc, eq, gt, inArray, isNotNull, lt, type SQL, sql } from 'drizzle-orm';

import { asPlatform, type GatewayDatabase } from '../db/context.js';
import { type Job, jobs } from '../db/schema.js';
import { TASKS } from '../tasks/registry.js';
import type { TaskName } from '../tasks/task.js';
import { JobExecutor } from './job-executor.js';
import { JobWorkflows } from './job-workflows.js';
import { LIVE_STATUSES } from './job-states.js';

export const JANITOR_OPTIONS = Symbol('JANITOR_OPTIONS');

export interface JanitorOptions {
  outputRetentionHours: number;
}

const SWEEP_INTERVAL_MS = 60_000;
/**
 * Younger live jobs are left alone: their workflow may be starting or just ending, or they are
 * streaming (`TaskStreams`, which have no workflow and end within this window).
 */
export const GRACE_SECONDS = 60;
const PAGE_SIZE = 100;
/** Workflow lookups in flight at once. */
const CONCURRENCY = 10;

/**
 * Every minute: recovers live jobs whose workflow is not running (a start lost to a crash, a
 * workflow terminated or reset), and clears outputs past retention (the task's own, else the
 * service's). Every replica runs it; each step is idempotent, and one failing does not stop the
 * other.
 */
@Injectable()
export class JobsJanitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobsJanitor.name);
  private timer: NodeJS.Timeout | undefined;
  private sweeping = false;

  constructor(
    @InjectDatabase() private readonly db: GatewayDatabase,
    private readonly workflows: JobWorkflows,
    private readonly executor: JobExecutor,
    @Inject(JANITOR_OPTIONS) private readonly options: JanitorOptions,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Skipped while the previous sweep still runs (a slow Temporal, many live jobs). */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const steps = await Promise.allSettled([this.recoverLiveJobs(), this.purgeOutputs()]);
      for (const step of steps) {
        if (step.status === 'rejected') {
          this.logger.warn({ err: step.reason as unknown }, 'Job sweep step failed');
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  /** Walks every live job past the grace period, a page at a time in id order. */
  private async recoverLiveJobs(): Promise<void> {
    let after: string | undefined;
    for (;;) {
      const page = await asPlatform(this.db, (tx) =>
        tx
          .select({ id: jobs.id, status: jobs.status })
          .from(jobs)
          .where(
            and(
              inArray(jobs.status, LIVE_STATUSES),
              lt(jobs.createdAt, sql`now() - make_interval(secs => ${GRACE_SECONDS})`),
              after === undefined ? undefined : gt(jobs.id, after),
            ),
          )
          .orderBy(asc(jobs.id))
          .limit(PAGE_SIZE),
      );
      for (let i = 0; i < page.length; i += CONCURRENCY) {
        await Promise.all(page.slice(i, i + CONCURRENCY).map((job) => this.recover(job)));
      }
      if (page.length < PAGE_SIZE) return;
      after = page.at(-1)?.id;
    }
  }

  /** Never throws: one job that cannot be recovered now is retried on the next sweep. */
  private async recover(job: Pick<Job, 'id' | 'status'>): Promise<void> {
    try {
      const state = await this.workflows.state(job.id);
      if (state === 'running') return;
      if (state === 'missing' && job.status === 'queued') {
        await this.workflows.start(job.id);
        return;
      }
      // The workflow ended or vanished without finishing the job; nothing will finish it now.
      this.logger.warn({ jobId: job.id, workflow: state }, 'Failing a job its workflow left live');
      await this.executor.fail(job.id, 'provider');
    } catch (error) {
      this.logger.warn({ err: error, jobId: job.id }, 'Could not recover a live job');
    }
  }

  /**
   * Outputs past retention are cleared; the job keeps its hashes and counts. A task with a
   * shorter retention of its own (clarification drafts: 24 hours) is cleared after that.
   */
  private async purgeOutputs(): Promise<void> {
    const purge = (window: SQL, task?: TaskName) =>
      asPlatform(this.db, (tx) =>
        tx
          .update(jobs)
          .set({ output: null, outputPurgedAt: sql`now()` })
          .where(
            and(
              isNotNull(jobs.output),
              task === undefined ? undefined : eq(jobs.task, task),
              lt(jobs.finishedAt, sql`now() - ${window}`),
            ),
          ),
      );
    await purge(sql`make_interval(hours => ${this.options.outputRetentionHours})`);
    for (const task of Object.values(TASKS)) {
      if (task.outputRetentionHours === undefined) continue;
      await purge(sql`make_interval(hours => ${task.outputRetentionHours})`, task.name);
    }
  }
}
