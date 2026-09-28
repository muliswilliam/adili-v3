import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { and, asc, gt, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';

import { type Job, jobs, type schema } from '../db/schema.js';
import { JobExecutor } from './job-executor.js';
import { JobStarter } from './job-starter.js';
import { LIVE_STATUSES } from './job-states.js';

export const JANITOR_OPTIONS = Symbol('JANITOR_OPTIONS');

export interface JanitorOptions {
  outputRetentionDays: number;
}

const SWEEP_INTERVAL_MS = 60_000;
/** Younger live jobs are left alone: their workflow may be starting or just ending. */
const GRACE_SECONDS = 60;
const PAGE_SIZE = 100;
/** Workflow lookups in flight at once. */
const CONCURRENCY = 10;

/**
 * Every minute: recovers live jobs whose workflow is not running (a start lost to a crash, a
 * workflow terminated or reset), and clears outputs past retention. Every replica runs it;
 * each step is idempotent, and one failing does not stop the other.
 */
@Injectable()
export class JobsJanitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobsJanitor.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly starter: JobStarter,
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

  async sweep(): Promise<void> {
    const steps = await Promise.allSettled([this.recoverLiveJobs(), this.purgeOutputs()]);
    for (const step of steps) {
      if (step.status === 'rejected') {
        this.logger.warn({ err: step.reason as unknown }, 'Job sweep step failed');
      }
    }
  }

  /** Walks every live job past the grace period, oldest first, a page at a time. */
  private async recoverLiveJobs(): Promise<void> {
    let after: Pick<Job, 'createdAt' | 'id'> | undefined;
    for (;;) {
      const page = await this.db
        .select({ id: jobs.id, status: jobs.status, createdAt: jobs.createdAt })
        .from(jobs)
        .where(
          and(
            inArray(jobs.status, LIVE_STATUSES),
            lt(jobs.createdAt, sql`now() - make_interval(secs => ${GRACE_SECONDS})`),
            after &&
              or(
                gt(jobs.createdAt, after.createdAt),
                and(sql`${jobs.createdAt} = ${after.createdAt}`, gt(jobs.id, after.id)),
              ),
          ),
        )
        .orderBy(asc(jobs.createdAt), asc(jobs.id))
        .limit(PAGE_SIZE);
      for (let i = 0; i < page.length; i += CONCURRENCY) {
        await Promise.all(page.slice(i, i + CONCURRENCY).map((job) => this.recover(job)));
      }
      if (page.length < PAGE_SIZE) return;
      after = page.at(-1);
    }
  }

  /** Never throws: one job that cannot be recovered now is retried on the next sweep. */
  private async recover(job: Pick<Job, 'id' | 'status'>): Promise<void> {
    try {
      const state = await this.starter.state(job.id);
      if (state === 'running') return;
      if (state === 'missing' && job.status === 'queued') {
        await this.starter.start(job.id);
        return;
      }
      // The workflow ended or vanished without finishing the job; nothing will finish it now.
      await this.executor.fail(job.id, 'provider');
    } catch (error) {
      this.logger.warn({ err: error, jobId: job.id }, 'Could not recover a live job');
    }
  }

  /** Outputs past retention are cleared; the job keeps its hashes and counts. */
  private async purgeOutputs(): Promise<void> {
    await this.db
      .update(jobs)
      .set({ output: null, outputPurgedAt: sql`now()` })
      .where(
        and(
          isNotNull(jobs.output),
          lt(
            jobs.finishedAt,
            sql`now() - make_interval(days => ${this.options.outputRetentionDays})`,
          ),
        ),
      );
  }
}
