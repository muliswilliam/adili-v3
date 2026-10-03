import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  InternalApi,
  PROBLEM_CONTENT_TYPE,
  schemaRef,
  CurrentPrincipal,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  type Principal,
  ProblemException,
  ZodValidationPipe,
} from '@adili/api-kit';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import { AI_SCOPE } from '../internal-api.js';
import { isTerminal } from './job-states.js';
import type { JobView } from './job-view.js';
import { JobsService } from './jobs.service.js';

const idempotencyKey = z.uuid();

const REPLAYED_HEADER = {
  'Idempotent-Replayed': {
    description: '`true` when the key named an existing job, which is returned as it is now',
    schema: { type: 'string', enum: ['true'] },
  },
};

/**
 * Internal: not routed by the public entrypoint.
 *
 * Idempotency is the job's, not `@RequireIdempotencyKey()`'s: the job row holds the key, so a
 * replay returns the job as it is now (finished, perhaps) rather than the first response.
 * Keys are scoped per calling service, like the jobs. Callers are domain services with the `ai`
 * scope, acting for the tenant in `X-Acting-Tenant` (ADR-013 §8.8); each sees only its own jobs
 * of that tenant.
 */
@ApiTags('internal')
@ApiBearerAuth()
@InternalApi(AI_SCOPE)
@Controller('internal/v1')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post('tasks/:task')
  @ApiOperation({
    operationId: 'runTask',
    summary:
      'Create a job for a task (services); returns immediately, or waits up to `waitSeconds` for the result',
    description:
      'The Idempotency-Key names the job: a retry with the same key returns the first job. An ' +
      'equal request with a live or succeeded job returns that job (the cache). Completion is ' +
      'announced by ai.job.* events; a job already finished is returned with 200.',
  })
  @ApiParam({ name: 'task', schema: schemaRef('TaskName') })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated UUID, unique per logical request; reuse on retry',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ required: true, schema: schemaRef('TaskRequest') })
  @ApiOkResponse({
    description: 'The job has finished (within the wait window, or before)',
    schema: schemaRef('Job'),
    headers: REPLAYED_HEADER,
  })
  @ApiAcceptedResponse({
    description: 'Queued or running; completion announced by ai.job.* events',
    schema: schemaRef('Job'),
    headers: REPLAYED_HEADER,
  })
  @ApiProblemResponse(
    400,
    'Request failed validation, Idempotency-Key missing or not a UUID, or X-Acting-Tenant missing',
  )
  @ApiProblemResponse(404, 'Unknown task')
  @ApiProblemResponse(422, 'Idempotency-Key reused with a different request')
  @ApiResponse({
    status: 429,
    description:
      "Tenant's per-minute limit reached (code `rate-limit-exceeded`); no job was created. `retryAfterSeconds` and Retry-After say when to try again",
    content: { [PROBLEM_CONTENT_TYPE]: { schema: schemaRef('ProblemDetails') } },
    headers: {
      'Retry-After': {
        description: 'Seconds until the next request would be allowed',
        schema: { type: 'integer' },
      },
    },
  })
  async runTask(
    @Param('task') task: string,
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @ActingTenant() tenant: string,
    @CurrentPrincipal() caller: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<JobView> {
    const { job, replayed } = await this.jobs
      .run(task, body, tenant, caller, readKey(key))
      .catch((error: unknown) => {
        if (ProblemException.hasCode(error, ['rate-limit-exceeded'])) {
          const retryAfter = error.extensions.retryAfterSeconds;
          if (typeof retryAfter === 'number') void reply.header('retry-after', String(retryAfter));
        }
        throw error;
      });
    void reply.status(isTerminal(job.status) ? HttpStatus.OK : HttpStatus.ACCEPTED);
    if (replayed) void reply.header(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return job;
  }

  @Get('jobs/:jobId')
  @ApiOperation({
    operationId: 'getJob',
    summary: 'Job state and validated output (caller service only, for the tenant it acts for)',
  })
  @ApiParam({ name: 'jobId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ description: 'The job', schema: schemaRef('Job') })
  @ApiProblemResponse(400, 'The id is not a UUID, or X-Acting-Tenant is missing')
  @ApiProblemResponse(404, "Not found, another caller's job, or another tenant's")
  async getJob(
    @Param('jobId', new ZodValidationPipe(z.uuid())) jobId: string,
    @ActingTenant() tenant: string,
    @CurrentPrincipal() caller: Principal,
  ): Promise<JobView> {
    // Another caller's or another tenant's job is indistinguishable from a missing one.
    const job = await this.jobs.get(jobId, tenant, caller);
    if (!job) {
      throw new NotFoundException('No job with this id');
    }
    return job;
  }
}

function readKey(header: string | undefined): string {
  if (!header) {
    throw new ProblemException({
      type: 'idempotency-key-missing',
      title: 'Idempotency-Key required',
      status: HttpStatus.BAD_REQUEST,
      detail:
        'Send one Idempotency-Key header holding a UUID, unique per logical request, and reuse it on retry.',
    });
  }
  const key = idempotencyKey.safeParse(header);
  if (!key.success) {
    throw new ProblemException({
      type: 'idempotency-key-invalid',
      title: 'Idempotency-Key is not a UUID',
      status: HttpStatus.BAD_REQUEST,
      detail: 'A key derived from the request can be a name-based UUID (v5).',
    });
  }
  // UUIDs are case-insensitive; one spelling per key keeps the unique index honest.
  return key.data.toLowerCase();
}
