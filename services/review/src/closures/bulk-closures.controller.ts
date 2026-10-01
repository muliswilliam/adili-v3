import { Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  IDEMPOTENCY_KEY_HEADER,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  TENANT_KEY,
  ZodValidationPipe,
} from '@adili/api-kit';

import {
  type BulkApprovalResultView,
  BulkClosuresService,
  type ClosureFilter,
  closureFilter,
  type ClosureSummaryView,
} from './bulk-closures.service.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';
const SUPERVISORS = 'Problem code `supervisor-required`: bulk closure is for supervisors';
const FILTER = 'Query failed validation';

/**
 * Bulk closure (spec 08): the system's `compliant-no-issues` proposals of a cycle, counted and
 * approved in batches by the Commission's supervisors. Reviewers get 403; anyone outside the
 * Commission's review staff 404.
 */
@ApiTags('closures')
@Controller('v1/commissions/:slug/closures')
export class BulkClosuresController {
  constructor(private readonly closures: BulkClosuresService) {}

  @Get()
  @ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } })
  @ApiOperation({
    operationId: 'getBulkClosureSummary',
    summary: 'Eligible system proposals, sampled and approved counts for a cycle and filters',
  })
  @ApiQueryParameters(closureFilter)
  @ApiOkResponse({ description: 'Summary', schema: schemaRef('ClosureSummary') })
  @ApiProblemResponse(400, FILTER)
  @ApiProblemResponse(403, SUPERVISORS)
  @ApiProblemResponse(404, NOT_VISIBLE)
  summary(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(closureFilter)) filter: ClosureFilter,
  ): Promise<ClosureSummaryView> {
    return this.closures.summary(principal, slug, filter);
  }

  @Post()
  @HttpCode(200)
  @RequireIdempotencyKey()
  @ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } })
  @ApiOperation({
    operationId: 'approveBulkClosures',
    summary: 'Approve system-proposed closures matching the filters, in chunks (supervisor)',
    description:
      'Chunks of 100 per transaction, each allocating its CMP numbers in sequence. Closures of cases the caller once held are skipped. Sent again with the same Idempotency-Key after a failure, it resumes and reports every closure approved under the key.',
  })
  @ApiQueryParameters(closureFilter)
  @ApiOkResponse({ description: 'Result', schema: schemaRef('BulkApprovalResult') })
  @ApiProblemResponse(400, FILTER)
  @ApiProblemResponse(403, SUPERVISORS)
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(503, 'The Commission directory could not be reached; nothing changed')
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(closureFilter)) filter: ClosureFilter,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string,
  ): Promise<BulkApprovalResultView> {
    return this.closures.approve(principal, slug, filter, idempotencyKey);
  }
}
