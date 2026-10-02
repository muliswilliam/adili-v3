import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { rejectedBy } from '../internal-api/rejected.js';
import type { paths } from './ai-gateway-api.gen.js';
import {
  type AiJob,
  AiGatewayClient,
  AiGatewayUnavailable,
  type FeedbackInput,
  MAX_TASK_WAIT_SECONDS,
  type ReviewTask,
  type RunTaskOptions,
  type TaskRequest,
  type TenantAiStatus,
} from './ai-gateway-client.js';

/**
 * The scope the review service's token needs for the gateway's internal API; every call names
 * the Commission it acts for in `X-Acting-Tenant` (ADR-013 §8.8).
 */
export const AI_SCOPE = 'ai';

/** A task call that waits: the wait plus the default budget for the hop (ADR-013 §2). */
export const WAITING_TASK_TIMEOUT_MS = MAX_TASK_WAIT_SECONDS * 1000 + 2_000;

export interface HttpAiGatewayClientOptions {
  gatewayUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** For tests. */
  fetch?: typeof fetch;
}

const jobSchema = z.object({
  id: z.uuid(),
  task: z.string(),
  subjectRef: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'blocked']),
  reason: z
    .enum([
      'policy',
      'budget',
      'validation',
      'refused',
      'provider',
      'provider-unavailable',
      'timeout',
    ])
    .nullable(),
  promptVersion: z.int(),
  output: z.record(z.string(), z.unknown()).nullable(),
  finishedAt: z.string().nullable(),
});

/** A recorded rating: the review service keeps nothing of the answer but that it was recorded. */
const recorded = z.object({ jobId: z.uuid() }).transform(() => true);

const DATA_CLASS = z.enum(['synthetic', 'restricted', 'highly-confidential']);

const tenantStatusSchema = z.object({
  tenant: z.string(),
  enabled: z.boolean(),
  providerClass: z.enum(['external', 'self-hosted']).nullable(),
  dataClasses: z.array(DATA_CLASS),
});

/**
 * The ai-gateway's internal task and job API through the client generated from its contract
 * (ai-gateway-api-gen.ts), with the review service's own token (`ai`). Both calls only record or
 * read a job; the work happens on the gateway's queue, so the default synchronous budget holds,
 * except for a task call that waits for its job (`WAITING_TASK_TIMEOUT_MS`). A task request the gateway refuses (400, 404, 422) is `InternalApiRejected`; a rate limit (429)
 * or anything else unexpected `AiGatewayUnavailable`.
 */
export class HttpAiGatewayClient extends AiGatewayClient {
  private readonly gateway: ServiceClient<paths>;
  private readonly waiting: ServiceClient<paths>;

  constructor(options: HttpAiGatewayClientOptions) {
    super();
    const client = (timeoutMs?: number) =>
      createServiceClient<paths>({
        baseUrl: options.gatewayUrl,
        service: 'ai-gateway',
        tokens: options.tokens,
        unavailable: (message, cause) => new AiGatewayUnavailable(message, cause),
        timeoutMs,
        fetch: options.fetch,
      });
    this.gateway = client();
    this.waiting = client(WAITING_TASK_TIMEOUT_MS);
  }

  runTask(
    task: ReviewTask,
    request: TaskRequest,
    idempotencyKey: string,
    { waitSeconds = 0 }: RunTaskOptions = {},
  ): Promise<AiJob> {
    if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > MAX_TASK_WAIT_SECONDS) {
      throw new RangeError(`waitSeconds must be 0 to ${String(MAX_TASK_WAIT_SECONDS)}`);
    }
    const rejected = rejectedBy('ai-gateway');
    const { tenant, ...body } = request;
    return (waitSeconds > 0 ? this.waiting : this.gateway).call(
      (api) =>
        api.POST('/internal/v1/tasks/{task}', {
          params: {
            path: { task },
            header: { 'Idempotency-Key': idempotencyKey, 'X-Acting-Tenant': tenant },
          },
          body: { ...body, promptVersion: null, waitSeconds },
        }),
      {
        status: [200, 202],
        schema: jobSchema,
        otherwise: { 400: rejected, 404: rejected, 422: rejected },
      },
    );
  }

  getJob(tenant: string, jobId: string): Promise<AiJob | null> {
    return this.gateway.call(
      (api) =>
        api.GET('/internal/v1/jobs/{jobId}', {
          params: { path: { jobId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 200, schema: jobSchema, otherwise: { 404: () => null } },
    );
  }

  recordFeedback(tenant: string, jobId: string, feedback: FeedbackInput): Promise<boolean> {
    const rejected = rejectedBy('ai-gateway');
    return this.gateway.call(
      (api) =>
        api.PUT('/internal/v1/jobs/{jobId}/feedback', {
          params: { path: { jobId }, header: { 'X-Acting-Tenant': tenant } },
          body: feedback,
        }),
      { status: 200, schema: recorded, otherwise: { 400: rejected, 404: () => false } },
    );
  }

  tenantStatus(tenant: string): Promise<TenantAiStatus> {
    return this.gateway.call(
      (api) =>
        api.GET('/internal/v1/tenants/{tenant}/status', {
          params: { path: { tenant }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 200, schema: tenantStatusSchema },
    );
  }
}
