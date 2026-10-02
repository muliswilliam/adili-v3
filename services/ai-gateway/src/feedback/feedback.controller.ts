import { Body, Controller, NotFoundException, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  Scopes,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import {
  type FeedbackInput,
  feedbackInputSchema,
  FeedbackService,
  type FeedbackView,
} from './feedback.service.js';

/** Internal: not routed by the public entrypoint. Callers rate the outputs of their own jobs. */
@ApiTags('internal')
@ApiBearerAuth()
@Scopes('ai')
@Controller('internal/v1/jobs/:jobId/feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Put()
  @ApiOperation({
    operationId: 'recordFeedback',
    summary: "Record or update a reviewer's rating of a job's output (caller service only)",
    description:
      'One rating per reviewer per job: a second rating by the same reviewer replaces the first. ' +
      'Each rating announces ai.feedback.recorded.v1 (no note, no reviewer).',
  })
  @ApiOkResponse({ description: 'Recorded' })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(404, 'No succeeded job with this id visible to the caller')
  async record(
    @Param('jobId', new ZodValidationPipe(z.uuid())) jobId: string,
    @Body(new ZodValidationPipe(feedbackInputSchema)) input: FeedbackInput,
    @CurrentPrincipal() caller: Principal,
  ): Promise<FeedbackView> {
    const recorded = await this.feedback.record(jobId, input, caller);
    if (!recorded) throw new NotFoundException('No output with this id to rate');
    return recorded;
  }
}
