import { Body, Controller, NotFoundException, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  CurrentPrincipal,
  InternalApi,
  type Principal,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { AI_SCOPE } from '../internal-api.js';
import {
  type FeedbackInput,
  feedbackInputSchema,
  FeedbackService,
  type FeedbackView,
} from './feedback.service.js';

/**
 * Internal: not routed by the public entrypoint. Callers rate the outputs of their own jobs of
 * the tenant they act for (`X-Acting-Tenant`, ADR-013 §8.8).
 */
@ApiTags('internal')
@ApiBearerAuth()
@InternalApi(AI_SCOPE)
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
  @ApiParam({ name: 'jobId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ required: true, schema: schemaRef('FeedbackInput') })
  @ApiOkResponse({ description: 'Recorded', schema: schemaRef('Feedback') })
  @ApiProblemResponse(400, 'Request failed validation, or X-Acting-Tenant is missing')
  @ApiProblemResponse(
    404,
    'No succeeded job with this id of the caller, for the tenant it acts for',
  )
  async record(
    @Param('jobId', new ZodValidationPipe(z.uuid())) jobId: string,
    @Body(new ZodValidationPipe(feedbackInputSchema)) input: FeedbackInput,
    @ActingTenant() tenant: string,
    @CurrentPrincipal() caller: Principal,
  ): Promise<FeedbackView> {
    const recorded = await this.feedback.record(jobId, input, tenant, caller);
    if (!recorded) throw new NotFoundException('No output with this id to rate');
    return recorded;
  }
}
