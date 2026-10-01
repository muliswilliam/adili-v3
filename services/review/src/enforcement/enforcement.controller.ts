import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  TENANT_KEY,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { type ReasonInput, reasonInput } from '../determinations/determination-input.js';
import {
  type LadderPage,
  type LaddersQuery,
  laddersQuery,
  EnforcementService,
} from './enforcement.service.js';
import type { ActionView, LadderView } from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';
const DECIDER =
  'Problem code `separation-of-duties` (the caller held the case) or `supervisor-required` (a later step, or not review staff)';

const uuidParam = z.uuid();

const ApiUuidParam = (name: string) =>
  ApiParam({ name, schema: { type: 'string', format: 'uuid' } });

/**
 * The administrative action ladder for the Commission's reviewers and supervisors (spec 08): ladders and
 * their steps, approving or declining a drafted step, restarting a declined ladder. Anyone outside
 * the Commission's review staff gets 404.
 */
@ApiTags('actions')
@Controller('v1')
export class EnforcementController {
  constructor(private readonly enforcement: EnforcementService) {}

  @Get('commissions/:slug/actions')
  @ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } })
  @ApiOperation({
    operationId: 'listEnforcementLadders',
    summary:
      'Administrative action ladders (per overdue obligation or clarification) with current step and status',
  })
  @ApiQueryParameters(laddersQuery)
  @ApiOkResponse({
    description: 'Page',
    schema: {
      type: 'object',
      required: ['items', 'nextCursor'],
      properties: {
        items: { type: 'array', items: schemaRef('Ladder') },
        nextCursor: { type: ['string', 'null'] },
      },
    },
  })
  @ApiProblemResponse(400, 'Query failed validation, or the cursor is unknown')
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(laddersQuery)) query: LaddersQuery,
  ): Promise<LadderPage> {
    return this.enforcement.list(principal, slug, query);
  }

  @Get('review/ladders/:ladderId')
  @ApiUuidParam('ladderId')
  @ApiOperation({
    operationId: 'getLadder',
    summary: 'A ladder with all its steps, responses and payroll acknowledgements',
  })
  @ApiOkResponse({ description: 'Ladder', schema: schemaRef('Ladder') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('ladderId', new ZodValidationPipe(uuidParam)) ladderId: string,
  ): Promise<LadderView> {
    return this.enforcement.get(principal, ladderId);
  }

  @Post('review/actions/:actionId/approve')
  @HttpCode(200)
  @RequireIdempotencyKey()
  @ApiUuidParam('actionId')
  @ApiOperation({
    operationId: 'approveAction',
    summary:
      'Approve a proposed step (notice, warning: reviewer or supervisor not reviewer of record; stoppage, disciplinary: supervisor)',
  })
  @ApiOkResponse({
    description: 'Approved (issuance and payroll follow)',
    schema: schemaRef('AdministrativeAction'),
  })
  @ApiProblemResponse(403, DECIDER)
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `not-proposed`')
  @ApiProblemResponse(503, 'The Commission directory could not be reached; nothing changed')
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('actionId', new ZodValidationPipe(uuidParam)) actionId: string,
  ): Promise<ActionView> {
    return this.enforcement.approve(principal, actionId);
  }

  @Post('review/actions/:actionId/decline')
  @HttpCode(200)
  @ApiUuidParam('actionId')
  @ApiOperation({
    operationId: 'declineAction',
    summary: 'Decline a proposed step with a note (ends the ladder)',
  })
  @ApiOkResponse({ description: 'Declined', schema: schemaRef('AdministrativeAction') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(403, DECIDER)
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `not-proposed`')
  decline(
    @CurrentPrincipal() principal: Principal,
    @Param('actionId', new ZodValidationPipe(uuidParam)) actionId: string,
    @Body(new ZodValidationPipe(reasonInput)) body: ReasonInput,
  ): Promise<ActionView> {
    return this.enforcement.decline(principal, actionId, body);
  }

  @Post('review/ladders/:ladderId/restart')
  @HttpCode(200)
  @ApiUuidParam('ladderId')
  @ApiOperation({ operationId: 'restartLadder', summary: 'Supervisor restarts a declined ladder' })
  @ApiOkResponse({ description: 'Restarted', schema: schemaRef('Ladder') })
  @ApiProblemResponse(403, 'Problem code `supervisor-required`')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `ladder-not-declined`')
  restart(
    @CurrentPrincipal() principal: Principal,
    @Param('ladderId', new ZodValidationPipe(uuidParam)) ladderId: string,
  ): Promise<LadderView> {
    return this.enforcement.restart(principal, ladderId);
  }
}
