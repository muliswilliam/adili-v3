import { HttpStatus, Injectable } from '@nestjs/common';
import { callerOf, type Principal, ProblemException } from '@adili/api-kit';
import { InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { asTenant, type GatewayDatabase, type GatewayTransaction } from '../db/context.js';
import { CACHE_KEY, type Job, jobs, servesCache } from '../db/schema.js';
import { hashJson } from '../hashing.js';
import { Budgets } from '../policy/budgets.js';
import { GenAiTelemetry } from '../policy/telemetry.js';
import { findTask } from '../tasks/registry.js';
import type { TaskDefinition } from '../tasks/task.js';
import { Admission } from './admission.js';
import { recordJobEnded } from './job-ended.js';
import { JobWorkflows } from './job-workflows.js';
import { isTerminal } from './job-states.js';
import { toJobView, type JobView } from './job-view.js';
import { type Route, Routing } from './routing.js';
import { type TaskRequest, taskRequestSchema } from './task-request.js';

export interface RunTaskResult {
  job: JobView;
  /** True when the Idempotency-Key was seen before and the first job was returned. */
  replayed: boolean;
}

/** What a task request names: the job of its key, an equal request's cached job, or a new one. */
export interface FoundJob {
  kind: 'previous' | 'cached' | 'created';
  job: Job;
}

/** Two concurrent requests can race for the same key or cache entry; the loser reads the winner. */
const MAX_CREATE_ATTEMPTS = 3;

/** The prompt version a request runs: the one it pins, else the task's current one. */
function promptVersionFor(task: TaskDefinition, pinned: number | null): number {
  const promptVersion = pinned ?? task.currentPromptVersion;
  if (!task.promptVersions.includes(promptVersion)) {
    throw new ProblemException({
      type: 'prompt-version-unknown',
      title: 'Unknown prompt version',
      status: HttpStatus.BAD_REQUEST,
      detail: `Task ${task.name} has prompt versions ${task.promptVersions.join(', ')}.`,
    });
  }
  return promptVersion;
}

/**
 * A request's job identity: the cache key columns, and the hash of what the caller asked for
 * (the wait is not part of it, so a retry may wait differently).
 */
function jobKey(
  task: TaskDefinition,
  request: Pick<TaskRequest, 'dataClass' | 'subjectRef' | 'promptVersion' | 'input'>,
  promptVersion: number,
  route: Pick<Route, 'provider' | 'model'>,
  tenant: string,
  principal: Principal,
): { fields: Pick<Job, (typeof CACHE_KEY)[number]>; requestHash: string } {
  return {
    fields: {
      tenant,
      caller: callerOf(principal),
      subjectRef: request.subjectRef,
      dataClass: request.dataClass,
      task: task.name,
      promptVersion,
      provider: route.provider,
      model: route.model,
      inputHash: hashJson(request.input),
    },
    requestHash: hashJson({
      task: task.name,
      tenant,
      dataClass: request.dataClass,
      subjectRef: request.subjectRef,
      promptVersion: request.promptVersion,
      input: request.input,
    }),
  };
}

function keyReused(): ProblemException {
  return new ProblemException({
    type: 'idempotency-key-reused',
    title: 'Idempotency-Key reused',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    detail: 'This Idempotency-Key was already used for a different request.',
  });
}

/** Creates task jobs (cache and idempotency enforced by the database) and reads them back. */
@Injectable()
export class JobsService {
  constructor(
    @InjectDatabase() private readonly db: GatewayDatabase,
    private readonly routing: Routing,
    private readonly admission: Admission,
    private readonly budgets: Budgets,
    private readonly workflows: JobWorkflows,
    private readonly events: EventPublisher,
    private readonly telemetry: GenAiTelemetry,
  ) {}

  /**
   * Creates a job for a task call and starts it, unless the caller's Idempotency-Key names an
   * earlier job, or an equal request already has a live or succeeded job (the cache): then that
   * job is returned. Waits up to `waitSeconds` for the job to end.
   *
   * A new job counts against the tenant's per-minute limit (beyond it: 429, no job). A request
   * the classification gate refuses, or from a tenant past its monthly budget, is recorded as a
   * `blocked` job (reason `policy` or `budget`) that never reaches a provider; one routed to a
   * provider this process cannot reach fails at once with `provider-unavailable`.
   *
   * A request served from the cache does not record its key. Should the cached job fail, a
   * retry with that key runs a new job rather than returning the failed one: the retry of a
   * request whose outcome the caller never saw gets a fresh attempt instead of a failure.
   */
  async run(
    taskName: string,
    body: unknown,
    tenant: string,
    principal: Principal,
    idempotencyKey: string,
  ): Promise<RunTaskResult> {
    const task = findTask(taskName);
    if (!task) {
      throw new ProblemException({
        type: 'task-not-found',
        title: 'Unknown task',
        status: HttpStatus.NOT_FOUND,
        detail: `The gateway has no task ${taskName}.`,
      });
    }
    const request = taskRequestSchema(task).parse(body);
    if (task.streamed?.(request.input)) {
      throw new ProblemException({
        type: 'task-streamed',
        title: 'Streamed task input',
        status: HttpStatus.BAD_REQUEST,
        detail: `Task ${task.name} answers this input over its stream endpoint, not as a job.`,
      });
    }
    const found = await this.findOrCreate(
      task,
      request,
      tenant,
      principal,
      idempotencyKey,
      'queued',
    );
    return {
      job: await this.startAndWait(found.job, request.waitSeconds),
      replayed: found.kind === 'previous',
    };
  }

  /**
   * The job a task request names: the earlier job of its Idempotency-Key (`previous`; the same
   * key for another request is 422), else a live or succeeded job of an equal request (`cached`),
   * else a new one (`created`), in `initialStatus` or, when the classification gate or budget
   * refuses it, already ended, with its audit record and event. A new job counts against the
   * tenant's per-minute limit (beyond it: 429, no job).
   */
  async findOrCreate(
    task: TaskDefinition,
    request: TaskRequest,
    tenant: string,
    principal: Principal,
    idempotencyKey: string,
    initialStatus: 'queued' | 'running',
  ): Promise<FoundJob> {
    const promptVersion = promptVersionFor(task, request.promptVersion);
    const route = await this.routing.route(tenant, task.name);
    const { fields, requestHash } = jobKey(task, request, promptVersion, route, tenant, principal);

    // The caller's transactions see the acting tenant's jobs only (row-level security).
    const asCaller = <T>(work: (tx: GatewayTransaction) => Promise<T>) =>
      asTenant(this.db, tenant, work, fields.caller);
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const [previous] = await asCaller((tx) =>
        tx
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.tenant, tenant),
              eq(jobs.caller, fields.caller),
              eq(jobs.idempotencyKey, idempotencyKey),
            ),
          ),
      );
      if (previous) {
        if (previous.requestHash !== requestHash) throw keyReused();
        return { kind: 'previous', job: previous };
      }

      const [cached] = await asCaller((tx) =>
        tx
          .select()
          .from(jobs)
          .where(
            and(...CACHE_KEY.map((column) => eq(jobs[column], fields[column])), servesCache(jobs)),
          ),
      );
      if (cached) return { kind: 'cached', job: cached };

      const limit = await this.budgets.rateLimited(tenant);
      if (limit.limited) {
        throw ProblemException.fromCode('rate-limit-exceeded', {
          detail: `Tenant ${tenant} has reached its per-minute limit of AI task calls.`,
          extensions: { retryAfterSeconds: limit.retryAfterSeconds },
        });
      }
      const ending = await this.admission.refusal(tenant, request.dataClass, route.provider);
      const created = await asCaller(async (tx) => {
        const [job] = await tx
          .insert(jobs)
          .values({
            id: uuidv7(),
            ...fields,
            params: route.params,
            idempotencyKey,
            requestHash,
            ...(ending
              ? { ...ending, finishedAt: sql`now()` }
              : {
                  input: request.input,
                  status: initialStatus,
                  ...(initialStatus === 'running' && { startedAt: sql`now()` }),
                }),
          })
          // Lost a race on the key or the cache entry: the next attempt reads the winner.
          .onConflictDoNothing()
          .returning();
        if (job && isTerminal(job.status)) await recordJobEnded(tx, this.events, job);
        return job;
      });
      if (created) {
        if (isTerminal(created.status)) this.telemetry.jobFinished(created);
        return { kind: 'created', job: created };
      }
    }
    throw new Error('Could not create or find the job under contention');
  }

  /** A job is visible only to the caller that created it, acting for the job's tenant. */
  async get(id: string, tenant: string, principal: Principal): Promise<JobView | undefined> {
    const job = await this.find(id, tenant, callerOf(principal));
    return job ? toJobView(job) : undefined;
  }

  /**
   * Makes sure a queued job has its workflow (starting is idempotent, so this also heals a
   * start lost to a crash), then waits up to `waitSeconds` for it to end.
   */
  private async startAndWait(job: Job, waitSeconds: number): Promise<JobView> {
    if (job.status === 'queued') {
      await this.workflows.start(job.id);
    }
    if (isTerminal(job.status) || waitSeconds === 0) {
      return toJobView(job);
    }
    await this.workflows.waitForEnd(job.id, waitSeconds * 1000);
    return toJobView((await this.find(job.id, job.tenant, job.caller)) ?? job);
  }

  private async find(id: string, tenant: string, caller: string): Promise<Job | undefined> {
    const [job] = await asTenant(
      this.db,
      tenant,
      (tx) =>
        tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.id, id), eq(jobs.tenant, tenant), eq(jobs.caller, caller))),
      caller,
    );
    return job;
  }
}
