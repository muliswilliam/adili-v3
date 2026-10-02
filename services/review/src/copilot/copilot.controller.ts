import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  schemaRef,
} from '@adili/api-kit';

import { CopilotService, type CopilotView } from './copilot.service.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

/**
 * The copilot of a review case (spec 07c): the AI-assisted summary and flag explanations, and
 * their refresh. Both answers hold declaration content, so both are audited reads.
 */
@ApiTags('copilot')
@Controller('v1/review/cases/:caseId/copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Get()
  @AuditedRead({ action: 'review.copilot.viewed', resource: 'review-case' })
  @ApiParam({ name: 'caseId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getCaseCopilot',
    summary:
      'AI-assisted summary and flag explanations for the case (reviewer, supervisor; audited read)',
    description:
      "Reviewers and supervisors of the case's Commission; anyone else gets 404. Indicators, not findings: a named officer decides.",
  })
  @ApiOkResponse({ description: 'Copilot view', schema: schemaRef('CopilotView') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
  ): Promise<CopilotView> {
    return this.copilot.view(principal, caseId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuditedRead({ action: 'review.copilot.refreshed', resource: 'review-case' })
  @ApiParam({ name: 'caseId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'refreshCaseCopilot',
    summary: 'Re-request the summary and explanations (assignee or supervisor)',
  })
  @ApiAcceptedResponse({ description: 'Requested', schema: schemaRef('CopilotView') })
  @ApiProblemResponse(403, 'The caller is neither the assignee nor a supervisor')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem type `copilot-pending` (already requested) or `ai-not-enabled` (AI not enabled for this Commission)',
  )
  @ApiProblemResponse(502, 'Declarations unavailable')
  @ApiProblemResponse(503, 'The AI gateway is unavailable; nothing was requested')
  refresh(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId') caseId: string,
  ): Promise<CopilotView> {
    return this.copilot.refresh(principal, caseId);
  }
}
