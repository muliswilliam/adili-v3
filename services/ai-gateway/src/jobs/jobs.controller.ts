import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Logger,
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
import { TaskStreams } from './task-streams.js';

const idempotencyKey = z.uuid();

/** Between SSE heartbeats, so proxies keep a quiet stream open. */
const HEARTBEAT_MS = 15_000;

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
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly streams: TaskStreams,
  ) {}

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
    'Request failed validation, an input the task streams (`task-streamed`: `answer`-mode `answer-declarant-question`, sent to its stream endpoint), Idempotency-Key missing or not a UUID, or X-Acting-Tenant missing',
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

  @Post('tasks/answer-declarant-question/stream')
  @ApiOperation({
    operationId: 'streamAnswerDeclarantQuestion',
    summary:
      'Stream an answer (server-sent events: text deltas, then the job with its validated output)',
    description:
      'Runs an `answer`-mode input of `answer-declarant-question` as a job, in the request. Events: ' +
      "`delta` {text}, the answer's prose as the model writes it, provisional until the end; then " +
      'either `final` {job}, the succeeded job, whose output replaces the deltas (an answer that ' +
      'failed its checks arrives as `declined: true` with no blocks), or `error` {reason}, the job ' +
      'failed. A caller that disconnects mid-stream fails the job with reason `provider`, as the ' +
      'contract has no reason for it. A `: ping` comment is sent every 15 s. The Idempotency-Key names the job like the ' +
      "task endpoint's: a finished key returns its `final` (or `error`) only; an equal request " +
      'with a succeeded job is served from it as one `delta` and its `final`.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated UUID, unique per logical request; reuse on retry',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ required: true, schema: schemaRef('TaskRequest') })
  @ApiOkResponse({
    description:
      'SSE stream: `delta` {text}, then `final` {job: Job} or `error` {reason: JobReason}',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiProblemResponse(
    400,
    'Request failed validation, a `hints` input (`task-not-streamed`, run it as a job), Idempotency-Key missing or not a UUID, or X-Acting-Tenant missing',
  )
  @ApiProblemResponse(
    403,
    'The classification gate refused it (`task-blocked`, `reason: policy`); the blocked job is recorded',
  )
  @ApiProblemResponse(
    409,
    'The Idempotency-Key, or an equal request, is streaming now (`job-in-progress`)',
  )
  @ApiProblemResponse(422, 'Idempotency-Key reused with a different request')
  @ApiResponse({
    status: 429,
    description:
      "Tenant's per-minute limit reached (code `rate-limit-exceeded`, no job), or its monthly budget spent (`task-blocked`, `reason: budget`)",
    content: { [PROBLEM_CONTENT_TYPE]: { schema: schemaRef('ProblemDetails') } },
  })
  @ApiProblemResponse(503, 'No provider reachable for the route (`task-blocked`)')
  async streamAnswer(
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @ActingTenant() tenant: string,
    @CurrentPrincipal() caller: Principal,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const stream = await this.streams
      .open('answer-declarant-question', body, tenant, caller, readKey(key))
      .catch((error: unknown) => {
        if (ProblemException.hasCode(error, ['rate-limit-exceeded'])) {
          const retryAfter = error.extensions.retryAfterSeconds;
          if (typeof retryAfter === 'number') void reply.header('retry-after', String(retryAfter));
        }
        throw error;
      });
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(HttpStatus.OK, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    });
    const left = new AbortController();
    raw.on('close', () => {
      if (!raw.writableEnded) left.abort();
    });
    const ping = setInterval(() => raw.write(': ping\n\n'), HEARTBEAT_MS);
    try {
      for await (const frame of stream.frames(left.signal)) {
        raw.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
      }
    } catch (error) {
      // Every ending the stream knows is a frame; this is a bug, and the job is left to the janitor.
      this.logger.error({ err: error }, 'Task stream failed');
      if (!left.signal.aborted) raw.write(`event: error\ndata: {"reason":"provider"}\n\n`);
    } finally {
      clearInterval(ping);
      raw.end();
    }
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
