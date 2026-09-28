import { WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError } from '@temporalio/client';

/**
 * The parts of the Temporal client `TemporalObligationWorkflows` uses, recording starts and
 * signals. Workflows count as running once started; `down` makes every start fail (Temporal
 * unreachable), `closed` makes starts of those ids fail as already started (a workflow that ran).
 */
export class FakeTemporal {
  readonly starts: {
    workflowType: string;
    workflowId: string;
    options: Record<string, unknown>;
  }[] = [];
  readonly signals: { workflowId: string; signal: string; args: unknown[] }[] = [];
  down = false;
  readonly closed = new Set<string>();
  private readonly running = new Set<string>();

  readonly workflow = {
    start: (workflowType: string, options: { workflowId: string } & Record<string, unknown>) => {
      const { workflowId } = options;
      if (this.down) {
        return Promise.reject(new Error('Temporal unreachable'));
      }
      this.starts.push({ workflowType, workflowId, options });
      if (this.closed.has(workflowId)) {
        return Promise.reject(
          new WorkflowExecutionAlreadyStartedError('closed', workflowId, workflowType),
        );
      }
      this.running.add(workflowId);
      return Promise.resolve({ workflowId });
    },
    getHandle: (workflowId: string) => ({
      signal: (definition: { name: string } | string, ...args: unknown[]) => {
        if (!this.running.has(workflowId)) {
          return Promise.reject(new WorkflowNotFoundError('not found', workflowId, undefined));
        }
        const signal = typeof definition === 'string' ? definition : definition.name;
        this.signals.push({ workflowId, signal, args });
        return Promise.resolve();
      },
    }),
  };

  startedIds(): string[] {
    return this.starts.map((start) => start.workflowId);
  }

  reset(): void {
    this.starts.length = 0;
    this.signals.length = 0;
    this.down = false;
    this.closed.clear();
    this.running.clear();
  }
}
