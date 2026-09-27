import { setTimeout as sleep } from 'node:timers/promises';

import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { CACHE_KEY, type Job, jobs, type schema } from '../db/schema.js';
import { hashJson } from '../hashing.js';
import { findTask } from '../tasks/registry.js';
import { JobStarter } from './job-starter.js';
import { CACHEABLE_STATUSES, TERMINAL_STATUSES } from './job-states.js';
import { toJobView, type JobView } from './job-view.js';
import { Routing } from './routing.js';
import { taskRequestSchema } from './task-request.js';

export interface RunTaskResult {
  job: JobView;
  /** True when the Idempotency-Key was seen before and the first job was returned. */
  replayed: boolean;
}

/** Two concurrent requests can race for the same key or cache entry; the loser reads the winner. */
const MAX_CREATE_ATTEMPTS = 3;
const WAIT_POLL_MS = { first: 50, max: 500 };

/** Creates task jobs (cache and idempotency enforced by the database) and reads them back. */
@Injectable()
export class JobsService {
  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly routing: Routing,
    private readonly starter: JobStarter,
  ) {}

  /**
   * Creates a job for a task call and starts it, unless the caller's Idempotency-Key names an
   * earlier job, or an equal request already has a live or succeeded job (the cache): then that
   * job is returned. Waits up to `waitSeconds` for the job to end.
   *
   * A request served from the cache does not record its key. Should the cached job fail, a
   * retry with that key runs a new job rather than returning the failed one: the retry of a
   * request whose outcome the caller never saw gets a fresh attempt instead of a failure.
   */
  async run(
    taskName: string,
    body: unknown,
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
    const promptVersion = request.promptVersion ?? task.currentPromptVersion;
    if (!task.promptVersions.includes(promptVersion)) {
      throw new ProblemException({
        type: 'prompt-version-unknown',
        title: 'Unknown prompt version',
        status: HttpStatus.BAD_REQUEST,
        detail: `Task ${task.name} has prompt versions ${task.promptVersions.join(', ')}.`,
      });
    }
    const route = this.routing.route();
    const fields: Pick<Job, (typeof CACHE_KEY)[number]> = {
      tenant: request.tenant,
      caller: callerOf(principal),
      subjectRef: request.subjectRef,
      dataClass: request.dataClass,
      task: task.name,
      promptVersion,
      provider: route.provider,
      model: route.model,
      inputHash: hashJson(request.input),
    };
    // What the caller asked for; the wait is not part of it, so a retry may wait differently.
    const requestHash = hashJson({
      task: task.name,
      tenant: request.tenant,
      dataClass: request.dataClass,
      subjectRef: request.subjectRef,
      promptVersion: request.promptVersion,
      input: request.input,
    });

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const [previous] = await this.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.caller, fields.caller), eq(jobs.idempotencyKey, idempotencyKey)));
      if (previous) {
        if (previous.requestHash !== requestHash) {
          throw new ProblemException({
            type: 'idempotency-key-reused',
            title: 'Idempotency-Key reused',
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            detail: 'This Idempotency-Key was already used for a different request.',
          });
        }
        return { job: await this.startAndWait(previous, request.waitSeconds), replayed: true };
      }

      const [cached] = await this.db
        .select()
        .from(jobs)
        .where(
          and(
            ...CACHE_KEY.map((column) => eq(jobs[column], fields[column])),
            inArray(jobs.status, CACHEABLE_STATUSES),
            isNull(jobs.outputPurgedAt),
          ),
        );
      if (cached) {
        return { job: await this.startAndWait(cached, request.waitSeconds), replayed: false };
      }

      const [created] = await this.db
        .insert(jobs)
        .values({
          id: uuidv7(),
          ...fields,
          idempotencyKey,
          requestHash,
          input: request.input,
          status: 'queued',
        })
        // Lost a race on the key or the cache entry: the next attempt reads the winner.
        .onConflictDoNothing()
        .returning();
      if (created) {
        return { job: await this.startAndWait(created, request.waitSeconds), replayed: false };
      }
    }
    throw new Error('Could not create or find the job under contention');
  }

  /** A job is visible only to the caller that created it. */
  async get(id: string, principal: Principal): Promise<JobView | undefined> {
    const job = await this.find(id, callerOf(principal));
    return job && toJobView(job);
  }

  /**
   * Makes sure a queued job has its workflow (starting is idempotent, so this also heals a
   * start lost to a crash), then waits up to `waitSeconds` for it to end.
   */
  private async startAndWait(job: Job, waitSeconds: number): Promise<JobView> {
    if (job.status === 'queued') {
      await this.starter.start(job.id);
    }
    const deadline = Date.now() + waitSeconds * 1000;
    let current = job;
    for (let pause = WAIT_POLL_MS.first; !TERMINAL_STATUSES.has(current.status);) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(pause, remaining));
      pause = Math.min(pause * 2, WAIT_POLL_MS.max);
      current = (await this.find(job.id, job.caller)) ?? current;
    }
    return toJobView(current);
  }

  private async find(id: string, caller: string): Promise<Job | undefined> {
    const [job] = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.caller, caller)));
    return job;
  }
}

/** Services are identified by OAuth client; tokens without one fall back to the subject. */
function callerOf(principal: Principal): string {
  return principal.clientId ?? principal.subject;
}
