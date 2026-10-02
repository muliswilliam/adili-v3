import { Body, Controller, Get, HttpStatus, Param, Post, Res } from '@nestjs/common';
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
  IdempotencyKey,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { uuidParam } from '../clarifications/clarification-input.js';
import { type CopilotDraft, CopilotDraftsService } from './copilot-drafts.service.js';
import { type CopilotDraftInput, copilotDraftInput } from './draft-input.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';
const GATEWAY_DOWN = 'The AI gateway cannot be reached (problem type `ai-gateway-unavailable`)';

const ApiUuidParam = (name: string) =>
  ApiParam({ name, schema: { type: 'string', format: 'uuid' } });

/**
 * Draft with AI (spec 07c S12): clarification items drafted from the assignee's selected flags
 * and items, for the composer. The answers hold text about the declaration, so both are audited
 * reads. Nothing here issues or stores a clarification.
 */
@ApiTags('copilot')
@Controller('v1/review')
export class CopilotDraftsController {
  constructor(private readonly drafts: CopilotDraftsService) {}

  @Post('cases/:caseId/copilot/drafts')
  // A pending draft is not a final answer: a retry asks again and gets the draft as it is now.
  @RequireIdempotencyKey({ settled: (draft: CopilotDraft) => draft.status !== 'pending' })
  @AuditedRead({ action: 'review.copilot.drafted', resource: 'review-case' })
  @ApiUuidParam('caseId')
  @ApiOperation({
    operationId: 'draftClarificationWithAi',
    summary:
      'Draft clarification items from selected flags and items (assignee); nothing is issued',
  })
  @ApiOkResponse({ description: 'Draft ready (or failed)', schema: schemaRef('CopilotDraft') })
  @ApiAcceptedResponse({
    description: 'Still drafting; poll the draft',
    schema: schemaRef('CopilotDraft'),
  })
  @ApiProblemResponse(400, 'Body failed validation, or problem type `selection-not-on-case`')
  @ApiProblemResponse(403, 'The caller is not the assignee of the case')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'AI not enabled for this Commission (problem type `ai-not-enabled`)')
  @ApiProblemResponse(502, 'The declaration could not be read; nothing was requested')
  @ApiProblemResponse(503, `${GATEWAY_DOWN}, or the Commission directory; nothing was requested`)
  async draft(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId', new ZodValidationPipe(uuidParam)) caseId: string,
    @Body(new ZodValidationPipe(copilotDraftInput)) body: CopilotDraftInput,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) reply: { status(code: number): unknown },
  ): Promise<CopilotDraft> {
    const draft = await this.drafts.draft(principal, caseId, body, key);
    reply.status(draft.status === 'pending' ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return draft;
  }

  @Get('copilot/drafts/:draftId')
  @AuditedRead({ action: 'review.copilot.draft-viewed', resource: 'review-copilot-draft' })
  @ApiUuidParam('draftId')
  @ApiOperation({ operationId: 'getCopilotDraft', summary: 'Poll a pending draft (assignee)' })
  @ApiOkResponse({ description: 'Draft', schema: schemaRef('CopilotDraft') })
  @ApiProblemResponse(404, `${NOT_VISIBLE}, or past its 24 hours`)
  @ApiProblemResponse(503, GATEWAY_DOWN)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('draftId', new ZodValidationPipe(uuidParam)) draftId: string,
  ): Promise<CopilotDraft> {
    return this.drafts.get(principal, draftId);
  }
}
