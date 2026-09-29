import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { type ClarificationInput, clarificationInput, uuidParam } from './clarification-input.js';
import { ClarificationsService } from './clarifications.service.js';
import type { ClarificationView } from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';
const NOT_ASSIGNEE = 'Caller is not the assignee of the case';

const ApiUuidParam = (name: string) =>
  ApiParam({ name, schema: { type: 'string', format: 'uuid' } });

/**
 * Clarifications for the Commission's reviewers and supervisors (spec 07a). Composing and issuing
 * are for the case's assignee; anyone outside the Commission's review staff gets 404.
 */
@ApiTags('clarifications')
@Controller('v1/review')
export class ClarificationsController {
  constructor(private readonly clarifications: ClarificationsService) {}

  @Post('cases/:caseId/clarifications')
  @ApiUuidParam('caseId')
  @ApiOperation({
    operationId: 'createClarificationDraft',
    summary: 'Create a clarification draft (assignee only)',
  })
  @ApiCreatedResponse({ description: 'Draft', schema: schemaRef('Clarification') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(403, NOT_ASSIGNEE)
  @ApiProblemResponse(404, NOT_VISIBLE)
  createDraft(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId', new ZodValidationPipe(uuidParam)) caseId: string,
    @Body(new ZodValidationPipe(clarificationInput)) body: ClarificationInput,
  ): Promise<ClarificationView> {
    return this.clarifications.createDraft(principal, caseId, body);
  }

  @Get('clarifications/:clarificationId')
  @ApiUuidParam('clarificationId')
  @ApiOperation({
    operationId: 'getClarification',
    summary: 'Clarification with items, letter and response',
  })
  @ApiOkResponse({ description: 'Clarification', schema: schemaRef('Clarification') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('clarificationId', new ZodValidationPipe(uuidParam)) clarificationId: string,
  ): Promise<ClarificationView> {
    return this.clarifications.get(principal, clarificationId);
  }

  @Put('clarifications/:clarificationId')
  @ApiUuidParam('clarificationId')
  @ApiOperation({ operationId: 'updateClarificationDraft', summary: "Update a draft's items" })
  @ApiOkResponse({ description: 'Draft', schema: schemaRef('Clarification') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(403, NOT_ASSIGNEE)
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `not-a-draft`')
  updateDraft(
    @CurrentPrincipal() principal: Principal,
    @Param('clarificationId', new ZodValidationPipe(uuidParam)) clarificationId: string,
    @Body(new ZodValidationPipe(clarificationInput)) body: ClarificationInput,
  ): Promise<ClarificationView> {
    return this.clarifications.updateDraft(principal, clarificationId, body);
  }

  @Post('clarifications/:clarificationId/issue')
  @HttpCode(200)
  @RequireIdempotencyKey()
  @ApiUuidParam('clarificationId')
  @ApiOperation({
    operationId: 'issueClarification',
    summary:
      'Allocate the CLR reference, issue the letter, notify the declarant, start the 30-day clock',
  })
  @ApiOkResponse({ description: 'Issued', schema: schemaRef('Clarification') })
  @ApiProblemResponse(400, 'Problem code `clarification-has-no-items`')
  @ApiProblemResponse(403, NOT_ASSIGNEE)
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `clarification-window-closed` or `not-a-draft`')
  issue(
    @CurrentPrincipal() principal: Principal,
    @Param('clarificationId', new ZodValidationPipe(uuidParam)) clarificationId: string,
  ): Promise<ClarificationView> {
    return this.clarifications.issue(principal, clarificationId);
  }
}
