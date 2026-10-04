import { randomUUID } from 'node:crypto';

import {
  Client,
  type Workflow,
  type WorkflowHandle,
  type WorkflowHandleWithFirstExecutionRunId,
  type WorkflowResultType,
  type WorkflowStartOptions,
} from '@temporalio/client';
import { historyToJSON } from '@temporalio/common/lib/proto-utils.js';
import { temporal } from '@temporalio/proto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  bundleWorkflowCode,
  DefaultLogger,
  Runtime,
  Worker,
  type WorkflowBundle,
} from '@temporalio/worker';

import type { TestProject } from 'vitest/node';

import type { TemporalWorkerReadinessCheck, WorkflowBundler } from './temporal-worker.module.js';

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
  /** The workflow `run` drives now (one at a time), which `skipTime` lets settle around each skip. */
  private runWorkflow: WorkflowHandle | undefined;
  /** Whether a `run` is under way (from before its workflow starts). */
  private running = false;

  private constructor(readonly env: TestWorkflowEnvironment) {
    this.steadyClient = new Client({ connection: env.connection, namespace: env.namespace });
  }

  static async create(): Promise<WorkflowTestEnvironment> {
    installQuietRuntime();
    return new WorkflowTestEnvironment(await startTimeSkippingServer());
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
    if (this.running) throw new Error('WorkflowTestEnvironment.run drives one workflow at a time');
    // Claimed before anything starts, so a second run fails without leaving a workflow behind.
    this.running = true;
    try {
      return await this.withWorker(options, async (taskQueue) => {
        const handle = await this.steadyClient.workflow.start(
          workflow,
          this.startOptions(taskQueue, options),
        );
        this.runWorkflow = handle;
        return body(handle);
      });
    } finally {
      this.running = false;
      this.runWorkflow = undefined;
    }
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
   *
   * In `run`, the skip leaves the workflow driven settled, with no timer about to fire, so what
   * the test sends next cannot race a timer. The time-skipping server strands a run whose
   * workflow task cancels a timer that fired while the task was with the worker: it refuses the
   * completion ("invalid history builder state for action", temporalio/sdk-java#3088) and never
   * times the task out or sends it again. Between skips the server's clock runs at real pace, and
   * each timer starts a few milliseconds after the instant a skip lands on (the workflow task's
   * own time), so the next one is due just after the skip ends: a signal sent then, its task slow
   * on a loaded machine, cancelled a timer that had fired meanwhile. So the skip waits for the
   * workflow to settle before it starts and after it ends, and goes on past any timer due within
   * `TIMER_GUARD_MS`.
   *
   * Limits in `run`: a skip can go past its target by up to `TIMER_GUARD_MS` per timer it skips
   * past (at most `MAX_GUARD_SKIPS` of them), so a test cannot assert that a timer has not fired
   * yet when it is due within `TIMER_GUARD_MS` of where the skip lands. An activity waiting
   * between retries counts as running, so a skip while one is in its backoff waits for it, and
   * fails after `SETTLE_TIMEOUT_MS` if the backoff is longer.
   */
  async skipTime(to: { ms: number } | { until: Date }): Promise<void> {
    const ms = 'ms' in to ? to.ms : to.until.getTime() - (await this.env.currentTimeMs());
    if (ms <= 0) return;
    const driven = this.runWorkflow;
    if (driven) await untilSettled(driven);
    await this.env.sleep(ms);
    if (!driven) return;
    for (let extra = 0; ; extra += 1) {
      await untilSettled(driven);
      const dueIn = await this.nextTimerDueIn(driven);
      if (dueIn === undefined || dueIn > TIMER_GUARD_MS) return;
      if (extra >= MAX_GUARD_SKIPS) {
        throw new Error(
          `Workflow ${driven.workflowId} keeps a timer due within ${String(TIMER_GUARD_MS)} ms after each skip; skipTime cannot leave it settled`,
        );
      }
      await this.env.sleep(Math.max(dueIn, 0) + 1);
    }
  }

  /** How long until the workflow's next timer fires, by the test server's clock; none: undefined. */
  private async nextTimerDueIn(handle: WorkflowHandle): Promise<number | undefined> {
    const events = (await handle.fetchHistory()).events ?? [];
    const now = await this.env.currentTimeMs();
    const due = pendingTimersDueAt(events);
    return due.length === 0 ? undefined : Math.min(...due) - now;
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

const { EventType } = temporal.api.enums.v1;

/** How long `untilSettled` waits for a workflow to settle before failing. */
const SETTLE_TIMEOUT_MS = 30_000;

/**
 * A timer due this soon after a skip ends is skipped past too: longer than a workflow task takes
 * on a loaded machine, and far shorter than any wait a workflow under test makes.
 */
const TIMER_GUARD_MS = 10_000;

/** Timers skipped past after one skip before `skipTime` gives up on a workflow that re-arms them. */
const MAX_GUARD_SKIPS = 10;

/**
 * Resolves once the workflow, by its history, has closed or has no workflow task outstanding and
 * no activity running: it waits on its timers and signals only.
 */
async function untilSettled(handle: WorkflowHandle): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  for (;;) {
    const events = (await handle.fetchHistory()).events ?? [];
    if (!busy(events)) return;
    if (Date.now() > deadline) {
      const last = events
        .slice(-5)
        .map(({ eventId, eventType }) => `${String(eventId)} ${EventType[eventType ?? 0] ?? '?'}`);
      throw new Error(
        `Workflow ${handle.workflowId} did not settle within ${String(SETTLE_TIMEOUT_MS)} ms; its last events: ${last.join(', ')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

type HistoryEvent = temporal.api.history.v1.IHistoryEvent;

/**
 * Whether the history has a workflow task or an activity not ended yet; a closed run is not. The
 * time-skipping server records a failed task's retry (`WorkflowTaskScheduled`, attempt 2) in
 * history, so a task retried after a failure counts as outstanding too.
 */
function busy(events: readonly HistoryEvent[]): boolean {
  let workflowTask = false;
  const activities = new Set<string>();
  for (const event of events) {
    switch (event.eventType) {
      case EventType.EVENT_TYPE_WORKFLOW_TASK_SCHEDULED:
        workflowTask = true;
        break;
      case EventType.EVENT_TYPE_WORKFLOW_TASK_COMPLETED:
      case EventType.EVENT_TYPE_WORKFLOW_TASK_FAILED:
      case EventType.EVENT_TYPE_WORKFLOW_TASK_TIMED_OUT:
        workflowTask = false;
        break;
      case EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED:
        activities.add(String(event.eventId));
        break;
      default: {
        const ended = activityEnded(event);
        if (ended !== undefined) activities.delete(ended);
      }
    }
  }
  const closed = CLOSED.has(events.at(-1)?.eventType ?? EventType.EVENT_TYPE_UNSPECIFIED);
  return !closed && (workflowTask || activities.size > 0);
}

/** The scheduled event id of the activity `event` ends, if it ends one. */
function activityEnded(event: HistoryEvent): string | undefined {
  const attributes =
    event.activityTaskCompletedEventAttributes ??
    event.activityTaskFailedEventAttributes ??
    event.activityTaskTimedOutEventAttributes ??
    event.activityTaskCanceledEventAttributes;
  return attributes?.scheduledEventId == null ? undefined : String(attributes.scheduledEventId);
}

/** When each timer started and not yet fired or cancelled is due, in ms since the epoch. */
function pendingTimersDueAt(events: readonly HistoryEvent[]): number[] {
  const pending = new Map<string, number>();
  for (const event of events) {
    const started = event.timerStartedEventAttributes;
    if (started?.timerId) {
      pending.set(started.timerId, protoMs(event.eventTime) + protoMs(started.startToFireTimeout));
    }
    const ended = event.timerFiredEventAttributes ?? event.timerCanceledEventAttributes;
    if (ended?.timerId) pending.delete(ended.timerId);
  }
  return [...pending.values()];
}

/** A protobuf timestamp (since the epoch) or duration, in milliseconds. */
function protoMs(
  value: { seconds?: { toString(): string } | null; nanos?: number | null } | null | undefined,
): number {
  return Number(value?.seconds?.toString() ?? 0) * 1000 + Math.floor((value?.nanos ?? 0) / 1e6);
}

const CLOSED: ReadonlySet<temporal.api.enums.v1.EventType> = new Set([
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED,
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED,
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT,
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED,
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_TERMINATED,
  EventType.EVENT_TYPE_WORKFLOW_EXECUTION_CONTINUED_AS_NEW,
]);

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

/** Starts of the test server tried before giving up. */
const SERVER_START_ATTEMPTS = 3;

/**
 * Temporal's core gives the test server five seconds to start (a fixed timeout). A machine
 * starting a server per test file in parallel can take longer, so a start that timed out is tried
 * again; any other failure is thrown at once.
 */
async function startTimeSkippingServer(): Promise<TestWorkflowEnvironment> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await TestWorkflowEnvironment.createTimeSkipping();
    } catch (error) {
      // The native bridge turns sdk-core's `EphemeralServerError::StartupTimeout` into a plain
      // Error (no name or code), so its message is the only thing that tells a timeout apart.
      const timedOut = error instanceof Error && error.message.includes('did not start within');
      if (!timedOut || attempt >= SERVER_START_ATTEMPTS) throw error;
    }
  }
}

/** Workflow bundles built once per test run: each workflows module's path to its bundled code. */
export type WorkflowBundles = Record<string, string>;

declare module 'vitest' {
  export interface ProvidedContext {
    /** Provided by `workflowBundlesSetup`, for `prebuiltWorkflowBundler`. */
    workflowBundles: WorkflowBundles;
  }
}

/**
 * A Vitest `globalSetup` for suites that boot a service with a `TemporalWorkerModule` in each test
 * file. It bundles each workflows module once, before any file runs, and provides the bundles to
 * the files, whose harnesses override `WorkflowBundler` with
 * `prebuiltWorkflowBundler(inject('workflowBundles'))`. Bundling is seconds of CPU; done in every
 * file's app start, on a runner busy with parallel suites, it pushed the start past the hook
 * timeout.
 *
 * ```ts
 * // test/support/workflow-bundles.ts, listed in the config's `globalSetup`
 * export default workflowBundlesSetup([fileURLToPath(new URL('../../src/workflows.ts', import.meta.url))]);
 * ```
 */
export function workflowBundlesSetup(
  workflowsPaths: readonly string[],
): (project: TestProject) => Promise<void> {
  return async (project) => {
    const bundles: WorkflowBundles = {};
    for (const workflowsPath of workflowsPaths) {
      const { code } = await bundleWorkflowCode({ workflowsPath, logger: quietLogger });
      bundles[workflowsPath] = code;
    }
    project.provide('workflowBundles', bundles);
  };
}

/**
 * A `WorkflowBundler` serving the bundles `workflowBundlesSetup` built, for
 * `.overrideProvider(WorkflowBundler)`. A worker whose workflows module the setup did not bundle
 * fails to start, naming the module.
 */
export function prebuiltWorkflowBundler(bundles: WorkflowBundles | undefined): WorkflowBundler {
  return {
    bundle(workflowsPath) {
      const code = bundles?.[workflowsPath];
      if (code === undefined) {
        return Promise.reject(
          new Error(
            `No prebuilt workflow bundle for ${workflowsPath}: list it in the suite's workflowBundlesSetup`,
          ),
        );
      }
      return Promise.resolve({ code });
    },
  };
}

/**
 * Resolves once an app's `TemporalWorkerModule` worker polls its task queue, as a deployment
 * waits for readiness before it sends traffic. Harnesses that boot a service with a worker wait
 * for it after `app.init()`: the worker starts in the background, and a test running meanwhile
 * races it. Bundling the workflow code, seconds of CPU on the event loop, once made database
 * connections time out on a loaded runner (the pool's `connectionTimeoutMillis` timer fired
 * before the stalled loop read Postgres' answer); harnesses now serve bundles built once per run
 * (`workflowBundlesSetup`), so the worker only connects and loads the bundle.
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

/**
 * Resolves once an app's worker runs no activities. Terminating a workflow leaves its in-flight
 * activities running, so a harness that ends a test's workflows waits for them here before it
 * resets: a straggler's write would otherwise land in the next test.
 */
export async function untilActivitiesDrained(
  readiness: TemporalWorkerReadinessCheck,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (readiness.activitiesInFlight > 0) {
    if (Date.now() > deadline) {
      throw new Error(
        `${String(readiness.activitiesInFlight)} activities still in flight after ${String(timeoutMs)} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Terminates the workflows with these ids (one not running is fine), then waits until the app's
 * worker runs no activity (`untilActivitiesDrained`): a terminated run's activity in flight runs
 * on, and its write would land on what the test does next.
 */
export async function endWorkflows(
  client: Client,
  readiness: TemporalWorkerReadinessCheck,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) {
    try {
      await client.workflow.getHandle(id).terminate();
    } catch {
      // Never started, or ended already.
    }
  }
  await untilActivitiesDrained(readiness);
}
