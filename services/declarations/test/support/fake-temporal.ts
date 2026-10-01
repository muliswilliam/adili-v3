import { WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError } from '@temporalio/client';

/** How a fake workflow run ended; `Running` while it has not. */
type RunStatus = 'Running' | 'Completed' | 'Failed' | 'TimedOut' | 'Terminated' | 'Canceled';

interface Run {
  workflowId: string;
  status: RunStatus;
  closeTime?: Date;
}

/**
 * The parts of the Temporal client `TemporalObligationWorkflows` uses, recording starts and
 * signals, with Temporal's start semantics for `USE_EXISTING` and `ALLOW_DUPLICATE_FAILED_ONLY`: a
 * start of a running workflow is a no-op, of a completed one fails as already started, and of one
 * that stopped (`stop`) runs it again. `down` makes every start fail (Temporal unreachable).
 * `list` answers only the stopped-runs query.
 */
export class FakeTemporal {
  readonly starts: {
    workflowType: string;
    workflowId: string;
    options: Record<string, unknown>;
  }[] = [];
  readonly signals: { workflowId: string; signal: string; args: unknown[] }[] = [];
  down = false;
  private readonly runs: Run[] = [];

  readonly workflow = {
    start: (workflowType: string, options: { workflowId: string } & Record<string, unknown>) => {
      const { workflowId } = options;
      if (this.down) {
        return Promise.reject(new Error('Temporal unreachable'));
      }
      this.starts.push({ workflowType, workflowId, options });
      const latest = this.latest(workflowId);
      if (latest?.status === 'Completed') {
        return Promise.reject(
          new WorkflowExecutionAlreadyStartedError('completed', workflowId, workflowType),
        );
      }
      if (latest?.status !== 'Running') this.runs.push({ workflowId, status: 'Running' });
      return Promise.resolve({ workflowId });
    },
    getHandle: (workflowId: string) => ({
      signal: (definition: { name: string } | string, ...args: unknown[]) => {
        if (this.latest(workflowId)?.status !== 'Running') {
          return Promise.reject(new WorkflowNotFoundError('not found', workflowId, undefined));
        }
        const signal = typeof definition === 'string' ? definition : definition.name;
        this.signals.push({ workflowId, signal, args });
        return Promise.resolve();
      },
    }),
    list: ({ query }: { query: string }) => {
      if (!query.includes("ExecutionStatus IN ('Failed', 'TimedOut', 'Terminated', 'Canceled')")) {
        throw new Error(`FakeTemporal cannot answer ${query}`);
      }
      const stopped = this.runs.filter(
        (run) => run.status !== 'Running' && run.status !== 'Completed',
      );
      return (async function* () {
        for (const run of stopped) {
          await Promise.resolve();
          yield { workflowId: run.workflowId, closeTime: run.closeTime };
        }
      })();
    },
  };

  /** Ends the running workflow `workflowId` as `status`, closing now or at `at`. */
  stop(workflowId: string, status: Exclude<RunStatus, 'Running'>, at = new Date()): void {
    const run = this.latest(workflowId);
    if (run?.status !== 'Running') throw new Error(`${workflowId} is not running`);
    run.status = status;
    run.closeTime = at;
  }

  /** Runs of `workflowId`, oldest first, by how each ended. */
  runsOf(workflowId: string): RunStatus[] {
    return this.runs.filter((run) => run.workflowId === workflowId).map((run) => run.status);
  }

  startedIds(): string[] {
    return this.starts.map((start) => start.workflowId);
  }

  reset(): void {
    this.starts.length = 0;
    this.signals.length = 0;
    this.down = false;
    this.runs.length = 0;
  }

  private latest(workflowId: string): Run | undefined {
    return this.runs.findLast((run) => run.workflowId === workflowId);
  }
}
