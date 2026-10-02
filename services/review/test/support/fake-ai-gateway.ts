import { randomUUID } from 'node:crypto';

import type { EventEnvelope } from '@adili/events';
import { v7 as uuidv7 } from 'uuid';

import {
  type AiJob,
  type AiJobReason,
  AiGatewayClient,
  AiGatewayUnavailable,
  type FeedbackInput,
  type ReviewTask,
  type TaskRequest,
} from '../../src/ai-gateway/ai-gateway-client.js';
import { InternalApiRejected } from '../../src/internal-api/rejected.js';

/** A task call as the fake gateway received it. */
export interface TaskCall {
  task: ReviewTask;
  request: TaskRequest;
  idempotencyKey: string;
}

/**
 * The ai-gateway's task and job API for tests, behaving as its contract says: one job per
 * idempotency key (a replay answers the first job), jobs `queued` until the test ends them with
 * `succeed`, `fail` or `block`, each of which answers the `ai.job.*` event the gateway would
 * publish. `blockEverything` ends every new job `blocked` at once, as the classification gate
 * does for a Commission without approval. Every call, and every rating, is recorded.
 */
export class FakeAiGateway extends AiGatewayClient {
  readonly calls: TaskCall[] = [];
  /** The ratings recorded, in order (a repeat is recorded again, as the gateway announces it). */
  readonly feedback: { jobId: string; feedback: FeedbackInput }[] = [];
  private readonly jobs = new Map<string, AiJob & { tenant: string }>();
  private readonly byKey = new Map<string, string>();
  private failures = 0;
  private blockedFor: AiJobReason | null = null;
  private rejecting = false;

  /** The jobs created, in order. */
  get created(): (AiJob & { tenant: string })[] {
    return [...this.jobs.values()];
  }

  /** The jobs of a task, in order. */
  jobsOf(task: ReviewTask): (AiJob & { tenant: string })[] {
    return this.created.filter((job) => job.task === task);
  }

  /** The next `count` calls fail as an outage would; nothing is created. */
  failCalls(count: number): void {
    this.failures = count;
  }

  /** Every new job ends `blocked` with `reason` at once (the gate, or the budget). */
  blockEverything(reason: AiJobReason = 'policy'): void {
    this.blockedFor = reason;
  }

  /** Every task call is refused (400), as for an input the gateway's schema rejects. */
  rejectRequests(): void {
    this.rejecting = true;
  }

  reset(): void {
    this.calls.length = 0;
    this.feedback.length = 0;
    this.jobs.clear();
    this.byKey.clear();
    this.failures = 0;
    this.blockedFor = null;
    this.rejecting = false;
  }

  runTask(task: ReviewTask, request: TaskRequest, idempotencyKey: string): Promise<AiJob> {
    this.calls.push({ task, request: structuredClone(request), idempotencyKey });
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new AiGatewayUnavailable('The ai-gateway is unavailable'));
    }
    if (this.rejecting) return Promise.reject(new InternalApiRejected('ai-gateway', 400));
    const existing = this.byKey.get(idempotencyKey);
    if (existing) return Promise.resolve(this.view(existing));
    const job: AiJob & { tenant: string } = {
      id: uuidv7(),
      task,
      tenant: request.tenant,
      subjectRef: request.subjectRef,
      status: 'queued',
      reason: null,
      promptVersion: 1,
      output: null,
      finishedAt: null,
    };
    if (this.blockedFor) {
      Object.assign(job, {
        status: 'blocked',
        reason: this.blockedFor,
        finishedAt: new Date().toISOString(),
      });
    }
    this.jobs.set(job.id, job);
    this.byKey.set(idempotencyKey, job.id);
    return Promise.resolve(this.view(job.id));
  }

  getJob(jobId: string): Promise<AiJob | null> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new AiGatewayUnavailable('The ai-gateway is unavailable'));
    }
    return Promise.resolve(this.jobs.has(jobId) ? this.view(jobId) : null);
  }

  /** Records a rating of a succeeded job; false for any other job, as the gateway answers 404. */
  recordFeedback(jobId: string, feedback: FeedbackInput): Promise<boolean> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new AiGatewayUnavailable('The ai-gateway is unavailable'));
    }
    if (this.jobs.get(jobId)?.status !== 'succeeded') return Promise.resolve(false);
    this.feedback.push({ jobId, feedback: structuredClone(feedback) });
    return Promise.resolve(true);
  }

  /** Ends the job `succeeded` with `output`; answers `ai.job.completed.v1`. */
  succeed(jobId: string, output: Record<string, unknown>): EventEnvelope {
    return this.finish(jobId, { status: 'succeeded', reason: null, output });
  }

  /** Ends the job `failed` with `reason`; answers `ai.job.failed.v1`. */
  fail(jobId: string, reason: AiJobReason = 'provider'): EventEnvelope {
    return this.finish(jobId, { status: 'failed', reason, output: null });
  }

  /** Ends the job `blocked` with `reason`; answers `ai.job.blocked.v1`. */
  block(jobId: string, reason: AiJobReason = 'policy'): EventEnvelope {
    return this.finish(jobId, { status: 'blocked', reason, output: null });
  }

  /** The `ai.job.*` event of a job that has ended, as the RabbitMQ transport delivers it. */
  eventOf(jobId: string): EventEnvelope {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`No job ${jobId}`);
    const type =
      job.status === 'succeeded'
        ? 'ai.job.completed.v1'
        : job.status === 'failed'
          ? 'ai.job.failed.v1'
          : 'ai.job.blocked.v1';
    return {
      specversion: '1.0',
      id: uuidv7(),
      source: 'adili/ai-gateway',
      type,
      time: new Date().toISOString(),
      subject: job.id,
      datacontenttype: 'application/json',
      tenant: job.tenant,
      data: {
        jobId: job.id,
        task: job.task,
        tenant: job.tenant,
        subjectRef: job.subjectRef,
        promptVersion: job.promptVersion,
        provider: 'replay',
        model: 'claude-opus-5-5',
        inputHash: randomUUID(),
        outputHash: job.status === 'succeeded' ? randomUUID() : null,
        tokensIn: 100,
        tokensOut: 50,
        costMicros: 10,
        latencyMs: 5,
        reason: job.reason,
      },
    };
  }

  private finish(
    jobId: string,
    outcome: Pick<AiJob, 'status' | 'reason' | 'output'>,
  ): EventEnvelope {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`No job ${jobId}`);
    Object.assign(job, outcome, { finishedAt: new Date().toISOString() });
    return this.eventOf(jobId);
  }

  /** The job as the gateway's API gives it (the tenant is the fake's own bookkeeping). */
  private view(jobId: string): AiJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`No job ${jobId}`);
    return {
      id: job.id,
      task: job.task,
      subjectRef: job.subjectRef,
      status: job.status,
      reason: job.reason,
      promptVersion: job.promptVersion,
      output: structuredClone(job.output),
      finishedAt: job.finishedAt,
    };
  }
}
