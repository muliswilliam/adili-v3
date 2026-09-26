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
  type LogLevel,
  type LogMetadata,
  NativeConnection,
  Runtime,
  Worker,
} from '@temporalio/worker';

export interface TemporalWorkerModuleOptions {
  address: string;
  namespace: string;
  /** The queue this service polls; workflows and activities are started on it by name. */
  taskQueue: string;
  /** Module exporting the workflow functions. The worker bundles it on start. */
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

/** Runs the worker for the life of the application, reconnecting until Temporal answers. */
@Injectable()
class TemporalWorkerHost implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(TemporalWorkerHost.name);
  private worker: Worker | undefined;
  private running: Promise<void> | undefined;
  private readonly shutdown = new AbortController();

  constructor(
    @Inject(WORKER_OPTIONS) private readonly options: TemporalWorkerModuleOptions,
    @Inject(WORKER_ACTIVITIES) private readonly activities: Activities,
  ) {}

  /** True while the worker is polling its task queue. */
  get polling(): boolean {
    return this.worker?.getState() === 'RUNNING';
  }

  onApplicationBootstrap(): void {
    installRuntimeLogger();
    // Not awaited: the service starts (not ready) even if Temporal is down.
    this.running = this.runUntilStopped();
  }

  /** Drains before other shutdown hooks close the connections activities depend on. */
  async beforeApplicationShutdown(): Promise<void> {
    this.shutdown.abort();
    if (this.worker?.getState() === 'RUNNING') {
      this.worker.shutdown();
    }
    await this.running;
  }

  private async runUntilStopped(): Promise<void> {
    while (!this.stopping()) {
      let connection: NativeConnection | undefined;
      try {
        connection = await NativeConnection.connect({ address: this.options.address });
        this.worker = await this.createWorker(connection);
        if (!this.stopping()) {
          await this.worker.run();
        }
      } catch (error) {
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

  private createWorker(connection: NativeConnection): Promise<Worker> {
    const drainTimeoutMs = this.options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    return Worker.create({
      connection,
      namespace: this.options.namespace,
      taskQueue: this.options.taskQueue,
      workflowsPath: this.options.workflowsPath,
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
      : Promise.reject(new Error('worker is not polling its task queue'));
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
        TemporalWorkerHost,
        TemporalWorkerReadinessCheck,
      ],
      exports: [TemporalWorkerReadinessCheck, ...options.activities],
    };
  }
}

function collectActivities(instances: object[]): Activities {
  const activities: Activities = {};
  for (const instance of instances) {
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const method = prototype[name];
      if (name === 'constructor' || typeof method !== 'function') continue;
      if (name in activities) {
        throw new Error(`Activity "${name}" is defined by more than one provider`);
      }
      activities[name] = (method as Activities[string]).bind(instance);
    }
  }
  return activities;
}

let runtimeLoggerInstalled = false;

/** Routes the SDK's logs (worker state changes, task failures) through Nest's logger. */
function installRuntimeLogger(): void {
  if (runtimeLoggerInstalled) return;
  runtimeLoggerInstalled = true;
  const logger = new Logger('Temporal');
  const write = (level: LogLevel, message: string, meta: LogMetadata = {}) => {
    if (level === 'ERROR') logger.error(meta, message);
    else if (level === 'WARN') logger.warn(meta, message);
    else if (level === 'INFO') logger.log(meta, message);
    else logger.debug(meta, message);
  };
  try {
    Runtime.install({
      logger: {
        log: write,
        trace: (message, meta) => {
          write('TRACE', message, meta);
        },
        debug: (message, meta) => {
          write('DEBUG', message, meta);
        },
        info: (message, meta) => {
          write('INFO', message, meta);
        },
        warn: (message, meta) => {
          write('WARN', message, meta);
        },
        error: (message, meta) => {
          write('ERROR', message, meta);
        },
      },
      // Native (Rust core) warnings, such as lost server connections, go the same way.
      telemetryOptions: { logging: { filter: { core: 'WARN', other: 'WARN' }, forward: {} } },
    });
  } catch {
    // Something (a test environment, another worker) created the runtime first; keep its logger.
  }
}
