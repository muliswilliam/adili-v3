import { createServiceClient, type ServiceClient, type ServiceTokenClient } from '@adili/api-kit';
import { z } from 'zod';

import type { paths } from './ai-gateway-api.gen.js';
import {
  AiGatewayClient,
  AiGatewayUnavailable,
  EXTRACT_DOCUMENT,
  type ExtractionReading,
  type ExtractionJob,
  type ExtractionRequest,
} from './ai-gateway-client.js';

/** The scope the declarations service's token needs for the gateway's internal API. */
export const AI_SCOPE = 'ai:internal';

export interface HttpAiGatewayClientOptions {
  gatewayUrl: string;
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** For tests. */
  fetch?: typeof fetch;
}

const DOCUMENT_KINDS = [
  'title-deed',
  'logbook',
  'payslip',
  'bank-letter',
  'share-certificate',
  'other',
] as const;

/** The output of a succeeded `extract-document` job, as far as the service reads it. */
const outputSchema = z.object({
  detectedKind: z.enum(DOCUMENT_KINDS),
  fields: z.array(
    z.object({
      name: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
      confidence: z.number().min(0).max(1),
      page: z.int().min(1).nullable(),
    }),
  ),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<ExtractionReading>;

const jobSchema = z
  .object({
    id: z.uuid(),
    task: z.literal(EXTRACT_DOCUMENT),
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
        'document-unavailable',
        'document-unreadable',
      ])
      .nullable(),
    output: z.unknown(),
  })
  .transform((job, ctx): ExtractionJob => {
    let output: ExtractionJob['output'] = null;
    if (job.status === 'succeeded') {
      const parsed = outputSchema.safeParse(job.output);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: 'A succeeded job without its reading' });
        return z.NEVER;
      }
      output = parsed.data;
    }
    return { id: job.id, status: job.status, reason: job.reason, output };
  });

/**
 * The ai-gateway's internal task and job API through the client generated from its contract
 * (ai-gateway-api.gen.ts), with the service's own token (`ai:internal`) and the Commission in
 * `X-Acting-Tenant`. Both calls only record or read a job: the reading happens on the gateway's
 * queue, so the default synchronous budget holds. Any refusal (400, 404, 422) or rate limit is
 * `AiGatewayUnavailable`: the request is the service's own and sending it again later is all the
 * declarant can do.
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

  extractDocument(request: ExtractionRequest, idempotencyKey: string): Promise<ExtractionJob> {
    return this.gateway.call(
      (api) =>
        api.POST('/internal/v1/tasks/{task}', {
          params: {
            path: { task: EXTRACT_DOCUMENT },
            header: { 'Idempotency-Key': idempotencyKey, 'X-Acting-Tenant': request.tenant },
          },
          body: {
            dataClass: 'highly-confidential',
            subjectRef: request.subjectRef,
            promptVersion: null,
            waitSeconds: 0,
            input: request.input,
          },
        }),
      { status: [200, 202], schema: jobSchema },
    );
  }

  getJob(tenant: string, jobId: string): Promise<ExtractionJob | null> {
    return this.gateway.call(
      (api) =>
        api.GET('/internal/v1/jobs/{jobId}', {
          params: { path: { jobId }, header: { 'X-Acting-Tenant': tenant } },
        }),
      { status: 200, schema: jobSchema, otherwise: { 404: () => null } },
    );
  }
}
