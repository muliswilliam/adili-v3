import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';

import { jobs, type schema } from '../db/schema.js';
import { JobStarter } from './job-starter.js';

export const JANITOR_OPTIONS = Symbol('JANITOR_OPTIONS');

export interface JanitorOptions {
  outputRetentionDays: number;
}

const SWEEP_INTERVAL_MS = 60_000;
/** A queued job older than this lost its workflow start (a crash between commit and start). */
const QUEUED_GRACE_SECONDS = 60;
const RESTART_BATCH = 100;

/**
 * Every minute: starts workflows for jobs left queued, and clears outputs past retention.
 * Every replica runs it; both steps are idempotent.
 */
@Injectable()
export class JobsJanitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobsJanitor.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly starter: JobStarter,
    @Inject(JANITOR_OPTIONS) private readonly options: JanitorOptions,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Job sweep failed');
      });
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    await this.restartQueued();
    await this.purgeOutputs();
  }

  private async restartQueued(): Promise<void> {
    const stranded = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.status, 'queued'),
          lt(jobs.createdAt, sql`now() - make_interval(secs => ${QUEUED_GRACE_SECONDS})`),
        ),
      )
      .orderBy(jobs.createdAt)
      .limit(RESTART_BATCH);
    for (const { id } of stranded) {
      await this.starter.start(id);
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
