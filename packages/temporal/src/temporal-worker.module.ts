import { setTimeout as sleep } from 'node:timers/promises';

import {
  type BeforeApplicationShutdown,
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type ModuleMetadata,
  type OnApplicationBootstrap,
  type Type,
} from '@nestjs/common';
import { ReadinessCheck } from '@adili/api-kit';
import {
  bundleWorkflowCode,
  type Logger as TemporalLogger,
  type LogLevel,
  type LogMetadata,
  NativeConnection,
  Runtime,
  Worker,
  type WorkflowBundleOption,
} from '@temporalio/worker';

export interface TemporalWorkerModuleOptions {
  address: string;
  namespace: string;
  /** The queue this service polls; workflows and activities are started on it by name. */
  taskQueue: string;
  /** Module exporting the workflow functions. The worker bundles it on start (`WorkflowBundler`). */
  workflowsPath: string;
  /**
   * Nest providers whose public methods are the activities, registered by method name.
   * Keep helpers in other providers: every method on these classes becomes an activity.
   */
  activities: Type<object>[];
  /** Modules providing the activities' dependencies (global modules need not be listed). */
  imports?: ModuleMetadata['imports'];
  /** How long shutdown waits for in-flight activities before cancelling them. Default 30 s. */
  drainTimeoutMs?: number;
}

const WORKER_OPTIONS = Symbol('WORKER_OPTIONS');
const WORKER_ACTIVITIES = Symbol('WORKER_ACTIVITIES');
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
/** Cancelled activities get this long to clean up before the worker gives up on them. */
const CANCELLATION_GRACE_MS = 5_000;
const RESTART_DELAY_MS = 5_000;

type Activities = Record<string, (...args: unknown[]) => Promise<unknown>>;

/**
 * Builds the bundle a worker runs from its `workflowsPath`. Bundling takes seconds of CPU, so
 * integration test harnesses, which boot the app once per test file, replace this with bundles
 * built once per test run (`prebuiltWorkflowBundler` in `@adili/temporal/testing`).
 */
@Injectable()
export class WorkflowBundler {
  bundle(workflowsPath: string): Promise<WorkflowBundleOption> {
    return bundleWorkflowCode({ workflowsPath, logger: nestLogger({ infoAsDebug: true }) });
  }
}

/** Runs the worker for the life of the application, reconnecting until Temporal answers. */
@Injectable()
class TemporalWorkerHost implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(TemporalWorkerHost.name);
  private worker: Worker | undefined;
  private running: Promise<void> | undefined;
  /** Bundled once and reused across restarts: bundling takes seconds of CPU. */
  private bundle: Promise<WorkflowBundleOption> | undefined;
  private readonly shutdown = new AbortController();
  /** Why the last attempt to run the worker failed, until one runs. */
  private failure: unknown;

  constructor(
    @Inject(WORKER_OPTIONS) private readonly options: TemporalWorkerModuleOptions,
    @Inject(WORKER_ACTIVITIES) private readonly activities: Activities,
    private readonly bundler: WorkflowBundler,
  ) {}

  /** True while the worker is polling its task queue. */
  get polling(): boolean {
    return this.worker?.getState() === 'RUNNING';
  }

  /** Activities the worker is running now; none when it is not running. */
  get inFlightActivities(): number {
    return this.worker?.getStatus().numInFlightActivities ?? 0;
  }

  /** Why the worker is not running, if an attempt to run it failed. */
  get lastFailure(): unknown {
    return this.failure;
  }

  onApplicationBootstrap(): void {
    installRuntimeLogger();
    // Not awaited: the service starts (not ready) even if Temporal is down.
    this.running = this.runUntilStopped();
  }

  /**
   * Drains before other shutdown hooks close the connections activities depend on. Waits at most
   * the drain time plus the cancellation grace, whatever state the worker is in.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.shutdown.abort();
    if (this.worker?.getState() === 'RUNNING') {
      this.worker.shutdown();
    }
    const bound = new AbortController();
    const gaveUp = await Promise.race([
      this.running?.then(() => false),
      sleep(this.drainTimeoutMs() + CANCELLATION_GRACE_MS, true, { signal: bound.signal }),
    ]);
    bound.abort();
    if (gaveUp) {
      this.logger.warn('Temporal worker did not stop within the drain time; shutting down anyway');
    }
  }

  private async runUntilStopped(): Promise<void> {
    while (!this.stopping()) {
      let connection: NativeConnection | undefined;
      try {
        connection = await this.untilStopped(
          NativeConnection.connect({ address: this.options.address }),
        );
        if (!connection) break;
        const bundle = await this.untilStopped(this.bundleWorkflows());
        if (!bundle) break;
        this.worker = await this.createWorker(connection, bundle);
        this.failure = undefined;
        const running = this.worker.run();
        // Shutdown began while the worker was being created; a created worker only releases the
        // connection and its workflow threads once it has run, so run it straight into shutdown.
        if (this.stopping()) this.worker.shutdown();
        await running;
      } catch (error) {
        this.failure = error;
        if (this.stopping()) {
          this.logger.warn({ err: error }, 'Temporal worker gave up on in-flight activities');
        } else {
          this.logger.warn({ err: error }, 'Temporal worker failed; restarting');
        }
      } finally {
        this.worker = undefined;
        await connection?.close();
      }
      await sleep(RESTART_DELAY_MS, undefined, { signal: this.shutdown.signal }).catch(() => {
        // Shutdown cut the wait short.
      });
    }
  }

  private stopping(): boolean {
    return this.shutdown.signal.aborted;
  }

  /**
   * Resolves undefined if shutdown starts first: an unresponsive server can hold a connection
   * attempt open far longer than shutdown should wait, with nothing in flight to drain.
   */
  private async untilStopped<T extends object>(pending: Promise<T>): Promise<T | undefined> {
    const stopped = new Promise<undefined>((resolve) => {
      this.shutdown.signal.addEventListener(
        'abort',
        () => {
          resolve(undefined);
        },
        { once: true },
      );
    });
    const result = await Promise.race([pending, stopped]);
    if (!result) {
      // Release what the abandoned attempt produces if it succeeds later.
      pending
        .then((late) => (late instanceof NativeConnection ? late.close() : undefined))
        .catch(() => undefined);
    }
    return result;
  }

  private bundleWorkflows(): Promise<WorkflowBundleOption> {
    this.bundle ??= this.bundler.bundle(this.options.workflowsPath).catch((error: unknown) => {
      this.bundle = undefined;
      throw error;
    });
    return this.bundle;
  }

  private drainTimeoutMs(): number {
    return this.options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  }

  private createWorker(
    connection: NativeConnection,
    bundle: WorkflowBundleOption,
  ): Promise<Worker> {
    const drainTimeoutMs = this.drainTimeoutMs();
    return Worker.create({
      connection,
      namespace: this.options.namespace,
      taskQueue: this.options.taskQueue,
      workflowBundle: bundle,
      activities: this.activities,
      shutdownGraceTime: drainTimeoutMs,
      shutdownForceTime: drainTimeoutMs + CANCELLATION_GRACE_MS,
    });
  }
}

@Injectable()
export class TemporalWorkerReadinessCheck extends ReadinessCheck {
  readonly name = 'temporal-worker';

  constructor(private readonly host: TemporalWorkerHost) {
    super();
  }

  check(): Promise<void> {
    return this.host.polling
      ? Promise.resolve()
      : Promise.reject(
          new Error('worker is not polling its task queue', { cause: this.host.lastFailure }),
        );
  }
}

/**
 * What the worker is doing. Terminating or cancelling a workflow does not stop an activity it
 * already started: the activity runs on in the worker, and only its result is discarded.
 */
@Injectable()
export class TemporalWorkerStatus {
  constructor(private readonly host: TemporalWorkerHost) {}

  /** Activities the worker is running now, of any workflow; none when it is not running. */
  get inFlightActivities(): number {
    return this.host.inFlightActivities;
  }
}

/**
 * Hosts workflows and activities on one task queue (ADR-003, ADR-013 §4). Import it next to
 * `TemporalModule` in services that run workers and list `TemporalWorkerReadinessCheck`
 * in `CoreModule.forRoot({ readiness })`.
 */
@Module({})
export class TemporalWorkerModule {
  static forRoot(options: TemporalWorkerModuleOptions): DynamicModule {
    return {
      module: TemporalWorkerModule,
      imports: options.imports ?? [],
      providers: [
        { provide: WORKER_OPTIONS, useValue: options },
        ...options.activities,
        {
          provide: WORKER_ACTIVITIES,
          useFactory: (...instances: object[]) => collectActivities(instances),
          inject: options.activities,
        },
        WorkflowBundler,
        TemporalWorkerHost,
        TemporalWorkerReadinessCheck,
        TemporalWorkerStatus,
      ],
      exports: [TemporalWorkerReadinessCheck, TemporalWorkerStatus, ...options.activities],
    };
  }
}

/** Methods of each instance's class and its base classes; accessors are not activities. */
function collectActivities(instances: object[]): Activities {
  const activities: Activities = {};
  for (const instance of instances) {
    const seen = new Set<string>();
    for (
      let prototype = Object.getPrototypeOf(instance) as object | null;
      prototype && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype) as object | null
    ) {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        // An override in a subclass shadows the base class method of the same name.
        if (name === 'constructor' || seen.has(name)) continue;
        seen.add(name);
        const method: unknown = Object.getOwnPropertyDescriptor(prototype, name)?.value;
        if (typeof method !== 'function') continue;
        if (name in activities) {
          throw new Error(`Activity "${name}" is defined by more than one provider`);
        }
        activities[name] = (method as Activities[string]).bind(instance);
      }
    }
  }
  return activities;
}

let runtimeLoggerInstalled = false;

/** Routes the SDK's logs (worker state changes, task failures) through Nest's logger. */
function installRuntimeLogger(): void {
  if (runtimeLoggerInstalled) return;
  runtimeLoggerInstalled = true;
  try {
    Runtime.install({
      logger: nestLogger(),
      // Native (Rust core) warnings, such as lost server connections, go the same way.
      telemetryOptions: { logging: { filter: { core: 'WARN', other: 'WARN' }, forward: {} } },
      // Nest owns shutdown (beforeApplicationShutdown drains the worker in order); the runtime's
      // own signal handlers would stop workers out of band, or on signals Nest ignores.
      shutdownSignals: [],
    });
  } catch {
    // Something (a test environment, another worker) created the runtime first; keep its logger.
  }
}

/**
 * An SDK logger writing to Nest's logger. `infoAsDebug` demotes info lines, for the workflow
 * bundler, whose info output is Webpack's full build report.
 */
function nestLogger({ infoAsDebug = false } = {}): TemporalLogger {
  const logger = new Logger('Temporal');
  const log = (level: LogLevel, message: string, meta: LogMetadata = {}) => {
    if (level === 'ERROR') logger.error(meta, message);
    else if (level === 'WARN') logger.warn(meta, message);
    else if (level === 'INFO' && !infoAsDebug) logger.log(meta, message);
    else logger.debug(meta, message);
  };
  return {
    log,
    trace: (message, meta) => {
      log('TRACE', message, meta);
    },
    debug: (message, meta) => {
      log('DEBUG', message, meta);
    },
    info: (message, meta) => {
      log('INFO', message, meta);
    },
    warn: (message, meta) => {
      log('WARN', message, meta);
    },
    error: (message, meta) => {
      log('ERROR', message, meta);
    },
  };
}
