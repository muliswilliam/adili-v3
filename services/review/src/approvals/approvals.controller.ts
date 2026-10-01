import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  schemaRef,
  TENANT_KEY,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import {
  type ApprovalPage,
  type ApprovalsQuery,
  approvalsQuery,
  ApprovalsService,
  type ReassignApprovalInput,
  reassignApprovalInput,
  type ReassignedApproval,
} from './approvals.service.js';
import { APPROVAL_KINDS, type ApprovalKind } from './schema.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';
const SUPERVISORS = 'Problem code `supervisor-required`: approvals are for supervisors';

/**
 * The approvals inbox (spec 08): determinations, actions and referrals awaiting approval, for the
 * Commission's supervisors. Reviewers get 403; anyone outside the Commission's review staff 404.
 */
@ApiTags('approvals')
@Controller('v1')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('commissions/:slug/approvals')
  @ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } })
  @ApiOperation({
    operationId: 'listApprovals',
    summary: 'Proposed determinations, actions and referrals awaiting approval (supervisor)',
  })
  @ApiQueryParameters(approvalsQuery)
  @ApiOkResponse({
    description: 'Page',
    schema: {
      type: 'object',
      required: ['items', 'nextCursor', 'counts'],
      properties: {
        items: { type: 'array', items: schemaRef('ApprovalItem') },
        nextCursor: { type: ['string', 'null'] },
        counts: { type: 'object', additionalProperties: { type: 'integer' } },
      },
    },
  })
  @ApiProblemResponse(400, 'Query failed validation, or the cursor is unknown')
  @ApiProblemResponse(403, SUPERVISORS)
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(approvalsQuery)) query: ApprovalsQuery,
  ): Promise<ApprovalPage> {
    return this.approvals.list(principal, slug, query);
  }

  @Post('review/approvals/:kind/:subjectId/reassign')
  @HttpCode(200)
  @ApiParam({ name: 'kind', schema: { type: 'string', enum: [...APPROVAL_KINDS] } })
  @ApiParam({ name: 'subjectId', schema: { type: 'string', format: 'uuid' } })
  @AcceptIdempotencyKey()
  @ApiOperation({
    operationId: 'reassignApproval',
    summary:
      'Point an approval at another supervisor (informational; the separation rule still applies)',
  })
  @ApiOkResponse({ description: 'Reassigned', schema: schemaRef('ApprovalReassignment') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(403, SUPERVISORS)
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `not-proposed`')
  reassign(
    @CurrentPrincipal() principal: Principal,
    @Param('kind', new ZodValidationPipe(z.enum(APPROVAL_KINDS))) kind: ApprovalKind,
    @Param('subjectId', new ZodValidationPipe(z.uuid())) subjectId: string,
    @Body(new ZodValidationPipe(reassignApprovalInput)) body: ReassignApprovalInput,
  ): Promise<ReassignedApproval> {
    return this.approvals.reassign(principal, kind, subjectId, body);
  }
}
