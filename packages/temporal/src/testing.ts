import { randomUUID } from 'node:crypto';

import type { Workflow, WorkflowResultType, WorkflowStartOptions } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  bundleWorkflowCode,
  DefaultLogger,
  Runtime,
  Worker,
  type WorkflowBundle,
} from '@temporalio/worker';

export interface ExecuteWorkflowOptions<W extends Workflow> {
  /** Module exporting the workflow functions, as given to the worker in production. */
  workflowsPath: string;
  /** Activity implementations, usually mocks, keyed by activity name. */
  activities: Record<string, (...args: never[]) => Promise<unknown>>;
  args: Parameters<W>;
}

/**
 * Temporal's time-skipping test server for workflow tests: timers resolve instantly,
 * activities are mocks, and each workflow bundle is built once per test file.
 *
 * ```ts
 * const env = await WorkflowTestEnvironment.create();
 * const result = await env.execute(rosterImport, { workflowsPath, activities: { stage }, args });
 * await env.teardown();
 * ```
 */
export class WorkflowTestEnvironment {
  private readonly bundles = new Map<string, Promise<WorkflowBundle>>();

  private constructor(readonly env: TestWorkflowEnvironment) {}

  static async create(): Promise<WorkflowTestEnvironment> {
    installQuietRuntime();
    return new WorkflowTestEnvironment(await TestWorkflowEnvironment.createTimeSkipping());
  }

  /** Runs `workflow` to completion on a fresh task queue and returns its result. */
  async execute<W extends Workflow>(
    workflow: W,
    options: ExecuteWorkflowOptions<W>,
  ): Promise<WorkflowResultType<W>> {
    const taskQueue = `test-${randomUUID()}`;
    const worker = await Worker.create({
      connection: this.env.nativeConnection,
      taskQueue,
      workflowBundle: await this.bundle(options.workflowsPath),
      activities: options.activities,
    });
    const start = { taskQueue, workflowId: randomUUID(), args: options.args };
    // The SDK types `args` conditionally on the arity, which TS cannot resolve for a generic W.
    return worker.runUntil(
      this.env.client.workflow.execute(workflow, start as unknown as WorkflowStartOptions<W>),
    );
  }

  async teardown(): Promise<void> {
    await this.env.teardown();
  }

  private bundle(workflowsPath: string): Promise<WorkflowBundle> {
    let bundle = this.bundles.get(workflowsPath);
    if (!bundle) {
      // Bundling takes seconds; caching it keeps each workflow test in the millisecond range.
      bundle = bundleWorkflowCode({ workflowsPath, logger: quietLogger });
      this.bundles.set(workflowsPath, bundle);
    }
    return bundle;
  }
}

/** Test output shows failures only, not worker state changes and test-server warnings. */
function installQuietRuntime(): void {
  try {
    Runtime.install({
      logger: new DefaultLogger('ERROR'),
      telemetryOptions: { logging: { filter: { core: 'ERROR', other: 'ERROR' } } },
    });
  } catch {
    // Already installed by an earlier environment in this process.
  }
}

const noop = () => undefined;
const quietLogger = {
  log: noop,
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};
