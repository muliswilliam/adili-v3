import type { Logger } from '@nestjs/common';

/** How long a start-up task waits before trying again. */
const RETRY_MS = 60_000;

/**
 * Work the service does once it has started, such as making sure a Temporal schedule exists:
 * tried at `start()` and again every minute while it fails (Temporal or the directory not
 * reachable yet), until it succeeds or `stop()` is called at shutdown. Failures are logged as
 * warnings, never thrown.
 *
 * @example
 * private readonly task = new StartupTask(this.logger, 'Sweep schedule not created', () => this.create());
 * onApplicationBootstrap() { this.task.start(); }
 * onApplicationShutdown() { this.task.stop(); }
 */
export class StartupTask {
  private retry: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly logger: Logger,
    /** What the warning says when an attempt fails, e.g. `Sweep schedule not created`. */
    private readonly failure: string,
    private readonly work: () => Promise<void>,
  ) {}

  start(): void {
    void this.attempt();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
  }

  private async attempt(): Promise<void> {
    try {
      await this.work();
    } catch (error) {
      if (this.stopped) return;
      this.logger.warn({ err: error }, `${this.failure}; retrying`);
      this.retry = setTimeout(() => void this.attempt(), RETRY_MS);
    }
  }
}
