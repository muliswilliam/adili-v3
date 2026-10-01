import { randomUUID } from 'node:crypto';

import {
  Client,
  type Workflow,
  type WorkflowHandleWithFirstExecutionRunId,
  type WorkflowResultType,
  type WorkflowStartOptions,
} from '@temporalio/client';
import { historyToJSON } from '@temporalio/common/lib/proto-utils.js';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  bundleWorkflowCode,
  DefaultLogger,
  Runtime,
  Worker,
  type WorkflowBundle,
} from '@temporalio/worker';

import type { TemporalWorkerReadinessCheck } from './temporal-worker.module.js';

export interface ExecuteWorkflowOptions<W extends Workflow> {
  /** Module exporting the workflow functions, as given to the worker in production. */
  workflowsPath: string;
  /** Activity implementations, usually mocks, keyed by activity name. */
  activities: Record<string, (...args: never[]) => Promise<unknown>>;
  args: Parameters<W>;
  /** Default: a random id. */
  workflowId?: string;
}

/**
 * Temporal's time-skipping test server for workflow tests: timers resolve instantly,
 * activities are mocks, and each workflow bundle is built once per test file. Services using
 * `@adili/temporal/testing` add `@temporalio/testing` to their devDependencies.
 *
 * ```ts
 * const env = await WorkflowTestEnvironment.create();
 * const result = await env.execute(rosterImport, { workflowsPath, activities: { stage }, args });
 * await env.teardown();
 * ```
 */
export class WorkflowTestEnvironment {
  private readonly bundles = new Map<string, Promise<WorkflowBundle>>();
  /** A client that never skips time by itself, for `run`. */
  private readonly steadyClient: Client;

  private constructor(readonly env: TestWorkflowEnvironment) {
    this.steadyClient = new Client({ connection: env.connection, namespace: env.namespace });
  }

  static async create(): Promise<WorkflowTestEnvironment> {
    installQuietRuntime();
    return new WorkflowTestEnvironment(await TestWorkflowEnvironment.createTimeSkipping());
  }

  /** Runs `workflow` to completion on a fresh task queue and returns its result, skipping timers. */
  async execute<W extends Workflow>(
    workflow: W,
    options: ExecuteWorkflowOptions<W>,
  ): Promise<WorkflowResultType<W>> {
    return this.withWorker(options, (taskQueue) =>
      this.env.client.workflow.execute(workflow, this.startOptions(taskQueue, options)),
    );
  }

  /**
   * Starts `workflow` on a fresh task queue and keeps its worker running while `body` drives it:
   * signals, queries, `skipTime`. Time moves only through `skipTime` here: awaiting the handle's
   * `result()` waits in real time (the time-skipping client would jump to the workflow's next
   * timer, which for a workflow waiting on signals is its execution timeout). Resolves with what
   * `body` returns; the workflow may still run.
   */
  async run<W extends Workflow, R>(
    workflow: W,
    options: ExecuteWorkflowOptions<W>,
    body: (handle: WorkflowHandleWithFirstExecutionRunId<W>) => Promise<R>,
  ): Promise<R> {
    return this.withWorker(options, async (taskQueue) =>
      body(await this.steadyClient.workflow.start(workflow, this.startOptions(taskQueue, options))),
    );
  }

  private async withWorker<W extends Workflow, R>(
    options: ExecuteWorkflowOptions<W>,
    work: (taskQueue: string) => Promise<R>,
  ): Promise<R> {
    const taskQueue = `test-${randomUUID()}`;
    const worker = await Worker.create({
      connection: this.env.nativeConnection,
      taskQueue,
      workflowBundle: await this.bundle(options.workflowsPath),
      activities: options.activities,
    });
    return worker.runUntil(() => work(taskQueue));
  }

  private startOptions<W extends Workflow>(
    taskQueue: string,
    options: ExecuteWorkflowOptions<W>,
  ): WorkflowStartOptions<W> {
    const start = { taskQueue, workflowId: options.workflowId ?? randomUUID(), args: options.args };
    // The SDK types `args` conditionally on the arity, which TS cannot resolve for a generic W.
    return start as unknown as WorkflowStartOptions<W>;
  }

  /** The test server's clock: it jumps ahead as workflows wait on timers. */
  async now(): Promise<Date> {
    return new Date(await this.env.currentTimeMs());
  }

  /**
   * Moves the test server's clock forward by `ms` (or to `until`), firing the timers due on the
   * way and waiting for the activities they start.
   */
  async skipTime(to: { ms: number } | { until: Date }): Promise<void> {
    const ms = 'ms' in to ? to.ms : to.until.getTime() - (await this.env.currentTimeMs());
    if (ms > 0) await this.env.sleep(ms);
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

/** A workflow run's history as committed to a replay fixture. */
export interface RecordedHistory {
  workflowId: string;
  /** The history in Temporal's JSON form (`temporal workflow show --output json`). */
  history: unknown;
}

/** Fetches a finished (or continued-as-new) run's history in the fixture's form. */
export async function recordHistory(handle: {
  workflowId: string;
  fetchHistory: () => Promise<Parameters<typeof historyToJSON>[0]>;
}): Promise<RecordedHistory> {
  return {
    workflowId: handle.workflowId,
    history: JSON.parse(historyToJSON(await handle.fetchHistory())) as unknown,
  };
}

/**
 * Replays recorded histories against the current workflow code (ADR-003: replay tests in CI) and
 * throws if any no longer replays: a change that would break the workflows already running needs
 * `patched()`. Needs no Temporal server.
 */
export async function replayHistories(
  workflowsPath: string,
  histories: readonly RecordedHistory[],
): Promise<void> {
  installQuietRuntime();
  const workflowBundle = await bundleWorkflowCode({ workflowsPath, logger: quietLogger });
  const failures: string[] = [];
  for (const { workflowId, history } of histories) {
    try {
      await Worker.runReplayHistory(
        { workflowBundle, replayName: 'replay-test' },
        history,
        workflowId,
      );
    } catch (error) {
      failures.push(`${workflowId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Workflow histories no longer replay:\n${failures.join('\n')}`);
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

/**
 * Resolves once an app's `TemporalWorkerModule` worker polls its task queue, as a deployment
 * waits for readiness before it sends traffic. Harnesses that boot a service with a worker wait
 * for it after `app.init()`: the worker starts in the background by bundling the workflow code,
 * seconds of CPU on the event loop, and a test running meanwhile has its database connections
 * time out on a loaded runner (the pool's `connectionTimeoutMillis` timer fires before the
 * stalled loop reads Postgres' answer).
 */
export async function untilWorkerPolling(
  readiness: TemporalWorkerReadinessCheck,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await readiness.check();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`Temporal worker not polling after ${String(timeoutMs)} ms`, {
          cause: error,
        });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
