import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { rejectedBy } from '../internal-api/rejected.js';
import type { paths } from './ai-gateway-api.gen.js';
import {
  type AiJob,
  AiGatewayClient,
  AiGatewayUnavailable,
  type FeedbackInput,
  type ReviewTask,
  type TaskRequest,
  type TenantAiStatus,
} from './ai-gateway-client.js';

/** The scope the review service's token needs for the gateway's tasks and jobs. */
export const AI_SCOPE = 'ai';

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
 * read a job; the work happens on the gateway's queue, so the default synchronous budget holds.
 * A task request the gateway refuses (400, 404, 422) is `InternalApiRejected`; a rate limit (429)
 * or anything else unexpected `AiGatewayUnavailable`.
 */
export class HttpAiGatewayClient extends AiGatewayClient {
  private readonly gateway: ServiceClient<paths>;

  constructor(options: HttpAiGatewayClientOptions) {
    super();
    this.gateway = createServiceClient<paths>({
      baseUrl: options.gatewayUrl,
      service: 'ai-gateway',
      tokens: options.tokens,
      unavailable: (message, cause) => new AiGatewayUnavailable(message, cause),
      fetch: options.fetch,
    });
  }

  runTask(task: ReviewTask, request: TaskRequest, idempotencyKey: string): Promise<AiJob> {
    const rejected = rejectedBy('ai-gateway');
    return this.gateway.call(
      (api) =>
        api.POST('/internal/v1/tasks/{task}', {
          params: { path: { task }, header: { 'Idempotency-Key': idempotencyKey } },
          body: { ...request, promptVersion: null, waitSeconds: 0 },
        }),
      {
        status: [200, 202],
        schema: jobSchema,
        otherwise: { 400: rejected, 404: rejected, 422: rejected },
      },
    );
  }

  getJob(jobId: string): Promise<AiJob | null> {
    return this.gateway.call(
      (api) => api.GET('/internal/v1/jobs/{jobId}', { params: { path: { jobId } } }),
      { status: 200, schema: jobSchema, otherwise: { 404: () => null } },
    );
  }

  recordFeedback(jobId: string, feedback: FeedbackInput): Promise<boolean> {
    const rejected = rejectedBy('ai-gateway');
    return this.gateway.call(
      (api) =>
        api.PUT('/internal/v1/jobs/{jobId}/feedback', {
          params: { path: { jobId } },
          body: feedback,
        }),
      { status: 200, schema: recorded, otherwise: { 400: rejected, 404: () => false } },
    );
  }

  tenantStatus(tenant: string): Promise<TenantAiStatus> {
    return this.gateway.call(
      (api) => api.GET('/internal/v1/tenants/{tenant}/status', { params: { path: { tenant } } }),
      { status: 200, schema: tenantStatusSchema },
    );
  }
}
