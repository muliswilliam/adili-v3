import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import { refusedWith } from '../internal-api/internal-api.js';
import type { paths } from './ai-gateway-api.gen.js';
import {
  type AiJob,
  AiGatewayClient,
  AiGatewayUnavailable,
  MAX_TASK_WAIT_SECONDS,
  type ReportingTask,
  type RunTaskOptions,
  type TaskRequest,
} from './ai-gateway-client.js';

/**
 * The scope the reporting service's token needs for the gateway's internal API; every call names
 * the tenant it acts for in `X-Acting-Tenant` (ADR-013 §8.8).
 */
export const AI_SCOPE = 'ai:internal';

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
      'cancelled',
    ])
    .nullable(),
  promptVersion: z.int(),
  output: z.record(z.string(), z.unknown()).nullable(),
  finishedAt: z.string().nullable(),
});

/**
 * The ai-gateway's internal task and job API through the client generated from its contract
 * (ai-gateway-api.gen.ts), with the reporting service's own token (`ai:internal`). Both calls
 * only record or read a job; the work happens on the gateway's queue, so the default synchronous
 * budget holds, except for a task call that waits for its job (`WAITING_TASK_TIMEOUT_MS`). A task
 * request the gateway refuses (400, 404, 422) is `InternalApiRejected`; a rate limit (429) or
 * anything else unexpected `AiGatewayUnavailable`.
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
    task: ReportingTask,
    request: TaskRequest,
    idempotencyKey: string,
    { waitSeconds = 0 }: RunTaskOptions = {},
  ): Promise<AiJob> {
    if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > MAX_TASK_WAIT_SECONDS) {
      throw new RangeError(`waitSeconds must be 0 to ${String(MAX_TASK_WAIT_SECONDS)}`);
    }
    const { tenant, ...body } = request;
    return (waitSeconds > 0 ? this.waiting : this.gateway).call(
      (api) =>
        api.POST('/internal/v1/tasks/{task}', {
          params: {
            path: { task },
            header: { 'Idempotency-Key': idempotencyKey, 'X-Acting-Tenant': tenant },
          },
          body: { ...body, waitSeconds },
        }),
      {
        status: [200, 202],
        schema: jobSchema,
        otherwise: refusedWith('ai-gateway', [400, 404, 422]),
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
}
