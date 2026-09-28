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
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  type Principal,
  ProblemException,
  RequireScopes,
  ZodValidationPipe,
} from '@adili/api-kit';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import { isTerminal } from './job-states.js';
import type { JobView } from './job-view.js';
import { JobsService } from './jobs.service.js';

const idempotencyKey = z.uuid();

/**
 * Internal: not routed by the public entrypoint.
 *
 * Idempotency is the job's, not `@RequireIdempotencyKey()`'s: the job row holds the key, so a
 * replay returns the job as it is now (finished, perhaps) rather than the first response.
 * Keys are scoped per calling service, like the jobs. Callers are domain services with the `ai`
 * scope; each sees only its own jobs.
 */
@ApiTags('internal')
@ApiBearerAuth()
@RequireScopes('ai')
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
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated UUID, unique per logical request; reuse on retry',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'The job has finished (within the wait window, or before)' })
  @ApiAcceptedResponse({
    description: 'Queued or running; completion announced by ai.job.* events',
  })
  @ApiProblemResponse(400, 'Request failed validation, or Idempotency-Key missing')
  @ApiProblemResponse(404, 'Unknown task')
  @ApiProblemResponse(422, 'Idempotency-Key reused with a different request')
  async runTask(
    @Param('task') task: string,
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @CurrentPrincipal() caller: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<JobView> {
    const { job, replayed } = await this.jobs.run(task, body, caller, readKey(key));
    void reply.status(isTerminal(job.status) ? HttpStatus.OK : HttpStatus.ACCEPTED);
    if (replayed) void reply.header(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return job;
  }

  @Get('jobs/:jobId')
  @ApiOperation({
    operationId: 'getJob',
    summary: 'Job state and validated output (caller service only)',
  })
  @ApiOkResponse({ description: 'The job' })
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  async getJob(
    @Param('jobId', new ZodValidationPipe(z.uuid())) jobId: string,
    @CurrentPrincipal() caller: Principal,
  ): Promise<JobView> {
    // Another caller's job is indistinguishable from a missing one.
    const job = await this.jobs.get(jobId, caller);
    if (!job) {
      throw new NotFoundException('No job with this id');
    }
    return job;
  }
}

function readKey(header: string | undefined): string {
  const key = idempotencyKey.safeParse(header);
  if (key.success) return key.data;
  throw new ProblemException({
    type: 'idempotency-key-missing',
    title: 'Idempotency-Key required',
    status: HttpStatus.BAD_REQUEST,
    detail:
      'Send one Idempotency-Key header holding a UUID, unique per logical request, and reuse it on retry. A key derived from the request can be a name-based UUID (v5).',
  });
}
