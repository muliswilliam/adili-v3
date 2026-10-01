import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  AuditedRead,
  type AuthenticatedRequest,
  CurrentPrincipal,
  CurrentReadAudit,
  type Principal,
  type ReadAudit,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { reviewTenant } from '../cases/access.js';
import {
  DeterminationLetterService,
  type LetterDownloadView,
} from './determination-letter.service.js';
import {
  type DeterminationInput,
  determinationInput,
  type ReasonInput,
  reasonInput,
} from './determination-input.js';
import { DeterminationsService } from './determinations.service.js';
import type { DeterminationView } from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';
const DECIDER =
  'Problem code `separation-of-duties` (the caller proposed it or held the case) or `supervisor-required`';

const uuidParam = z.uuid();

const ApiUuidParam = (name: string) =>
  ApiParam({ name, schema: { type: 'string', format: 'uuid' } });

/**
 * Compliance determinations for the Commission's reviewers and supervisors (spec 08). The case's
 * assignee proposes; a supervisor who neither proposed it nor held the case approves or returns;
 * the proposer withdraws. Anyone outside the Commission's review staff gets 404.
 */
@ApiTags('determinations')
@Controller('v1/review')
export class DeterminationsController {
  constructor(
    private readonly determinations: DeterminationsService,
    private readonly letters: DeterminationLetterService,
  ) {}

  @Post('cases/:caseId/determinations')
  @ApiUuidParam('caseId')
  @AcceptIdempotencyKey()
  @ApiOperation({
    operationId: 'proposeDetermination',
    summary: 'Propose a compliance determination (assignee)',
  })
  @ApiCreatedResponse({ description: 'Proposed', schema: schemaRef('Determination') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(403, 'Problem code `not-the-assignee`')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem code `determination-open`: one is already proposed or approved; `clarification-open`: a clarification of the case is still open',
  )
  propose(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId', new ZodValidationPipe(uuidParam)) caseId: string,
    @Body(new ZodValidationPipe(determinationInput)) body: DeterminationInput,
  ): Promise<DeterminationView> {
    return this.determinations.propose(principal, caseId, body);
  }

  @Get('determinations/:determinationId')
  @ApiUuidParam('determinationId')
  @ApiOperation({ operationId: 'getDetermination', summary: 'One determination' })
  @ApiOkResponse({ description: 'Determination', schema: schemaRef('Determination') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('determinationId', new ZodValidationPipe(uuidParam)) determinationId: string,
  ): Promise<DeterminationView> {
    return this.determinations.get(principal, determinationId);
  }

  @Get('determinations/:determinationId/letter')
  @AuditedRead({ action: 'review.determination.letter.downloaded', resource: 'determination' })
  @ApiUuidParam('determinationId')
  @ApiOperation({
    operationId: 'getDeterminationLetter',
    summary: 'Decision letter download; issued on first request for bulk closures',
    description:
      "The Commission's reviewers and supervisors, and the declarant for their own approved determinations. A bulk closure's letter is issued the first time it is asked for, then served.",
  })
  @ApiOkResponse({ description: 'Download link', schema: schemaRef('LetterDownload') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `not-approved`')
  @ApiProblemResponse(502, 'The documents service refused the letter')
  @ApiProblemResponse(503, 'The documents service or the directory could not be reached')
  letter(
    @CurrentPrincipal() principal: Principal,
    @Req() request: AuthenticatedRequest,
    @Param('determinationId', new ZodValidationPipe(uuidParam)) determinationId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<LetterDownloadView> {
    const declarant = request.principal?.personId ?? null;
    // Review staff read the Commission's letters, audited. Anyone else reads only their own letter
    // as a declarant (anyone else's is 404): not an audited access. The service branches the same.
    if (reviewTenant(principal) === null && declarant !== null) audit.ownRecord();
    return this.letters.letter(principal, declarant, determinationId);
  }

  @Post('determinations/:determinationId/approve')
  @HttpCode(200)
  @RequireIdempotencyKey()
  @ApiUuidParam('determinationId')
  @ApiOperation({
    operationId: 'approveDetermination',
    summary:
      'Approve (supervisor who is neither proposer nor reviewer of record); allocates CMP and issues the letter',
  })
  @ApiOkResponse({ description: 'Approved', schema: schemaRef('Determination') })
  @ApiProblemResponse(403, DECIDER)
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `not-proposed`')
  @ApiProblemResponse(503, 'The Commission directory could not be reached; nothing changed')
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('determinationId', new ZodValidationPipe(uuidParam)) determinationId: string,
  ): Promise<DeterminationView> {
    return this.determinations.approve(principal, determinationId);
  }

  @Post('determinations/:determinationId/return')
  @HttpCode(200)
  @ApiUuidParam('determinationId')
  @AcceptIdempotencyKey()
  @ApiOperation({
    operationId: 'returnDetermination',
    summary: 'Return to the proposer with a reason',
  })
  @ApiOkResponse({ description: 'Returned', schema: schemaRef('Determination') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(403, DECIDER)
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `not-proposed`')
  return(
    @CurrentPrincipal() principal: Principal,
    @Param('determinationId', new ZodValidationPipe(uuidParam)) determinationId: string,
    @Body(new ZodValidationPipe(reasonInput)) body: ReasonInput,
  ): Promise<DeterminationView> {
    return this.determinations.return(principal, determinationId, body);
  }

  @Post('determinations/:determinationId/withdraw')
  @HttpCode(200)
  @ApiUuidParam('determinationId')
  @AcceptIdempotencyKey()
  @ApiOperation({
    operationId: 'withdrawDetermination',
    summary: 'Proposer withdraws while proposed',
  })
  @ApiOkResponse({ description: 'Withdrawn', schema: schemaRef('Determination') })
  @ApiProblemResponse(403, 'Problem code `not-the-proposer`')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `not-proposed`')
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('determinationId', new ZodValidationPipe(uuidParam)) determinationId: string,
  ): Promise<DeterminationView> {
    return this.determinations.withdraw(principal, determinationId);
  }
}
