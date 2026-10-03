import { Body, Controller, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  schemaRef,
  CurrentPrincipal,
  type Principal,
  ZodValidationPipe,
} from '@adili/api-kit';

import {
  CopilotFeedback,
  copilotFeedbackInput,
  type CopilotFeedbackInput,
} from './copilot-feedback.js';

/** Reviewers' ratings of copilot outputs (spec 07c S13), named by the output's job and block. */
@ApiTags('copilot')
@Controller('v1/review/copilot/outputs/:jobId/feedback')
export class CopilotFeedbackController {
  constructor(private readonly feedback: CopilotFeedback) {}

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'jobId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'rateCopilotOutput',
    summary:
      "Rate a copilot output shown on a case as helpful or not (the case's assignee); one rating per reviewer per output block",
    description:
      "The output is named by its job: a summary or explanations shown on the case (`CopilotView.jobs`), or a ready clarification draft within its 24 hours (`CopilotDraft.jobId`); `block` names the block rated (a summary's section, a flag's explanation), null the output as a whole. A second rating by the same reviewer of the same block replaces the first. A block the output does not have is 400. The rating is forwarded to the ai-gateway, which announces it for reporting. Supervisors and other reviewers of the Commission read the copilot but do not rate it (403); anyone else, or a job that is not such an output (a pending draft's, say), gets 404.",
  })
  @ApiBody({ required: true, schema: schemaRef('CopilotFeedbackInput') })
  @ApiOkResponse({ description: 'Recorded' })
  @ApiProblemResponse(
    400,
    'Request failed validation, or problem type `block-not-in-output`: the output has no such block, or `feedback-rejected`: the AI gateway refused the rating',
  )
  @ApiProblemResponse(
    403,
    "The caller is not the case's assignee (problem type `not-the-assignee`)",
  )
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  @ApiProblemResponse(
    503,
    'The ai-gateway cannot be reached (problem type `ai-gateway-unavailable`); nothing was recorded',
  )
  async rate(
    @CurrentPrincipal() principal: Principal,
    @Param('jobId') jobId: string,
    @Body(new ZodValidationPipe(copilotFeedbackInput)) body: CopilotFeedbackInput,
  ): Promise<void> {
    await this.feedback.rate(principal, jobId, body);
  }
}
