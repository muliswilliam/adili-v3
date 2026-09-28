import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  Roles,
  ZodValidationPipe,
} from '@adili/api-kit';

import { CommissionObligationsService, EACC_ROLES } from './commission-obligations.service.js';
import {
  type ListCommissionObligationsQuery,
  listCommissionObligationsQuery,
  type SummaryQuery,
  summaryQuery,
} from './commission-query.js';
import {
  COMMISSION_STAFF_ROLES,
  ObligationsService,
  PLATFORM_ADMIN,
} from './obligations.service.js';
import type {
  CommissionSummary,
  MyObligations,
  ObligationDetail,
  ObligationPage,
} from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

/** The `slug` path parameter, as the contract's `Slug`. */
const ApiSlugParam = () =>
  ApiParam({ name: 'slug', schema: { type: 'string', pattern: '^[a-z][a-z0-9]{1,19}$' } });

@ApiTags('obligations')
@Controller('v1')
export class ObligationsController {
  constructor(
    private readonly obligations: ObligationsService,
    private readonly commissions: CommissionObligationsService,
  ) {}

  @Get('me/obligations')
  @ApiOperation({
    operationId: 'getMyObligations',
    summary: "The signed-in declarant's obligations across Commissions",
    description: 'Authorised by the person_id claim. Staff tokens without it get 404.',
  })
  @ApiOkResponse({ description: 'Obligations grouped by Commission' })
  @ApiProblemResponse(404, NOT_VISIBLE)
  mine(@CurrentPrincipal() principal: Principal): Promise<MyObligations> {
    return this.obligations.mine(principal);
  }

  @Get('obligations/:id')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getObligation',
    summary: 'One obligation with its reminder history',
    description:
      "The declarant's own (officer null); staff of the obligation's Commission and platform admins (with the officer). Anyone else gets 404.",
  })
  @ApiOkResponse({ description: 'The obligation' })
  @ApiProblemResponse(404, NOT_VISIBLE)
  one(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Promise<ObligationDetail> {
    return this.obligations.one(principal, id);
  }

  @Get('commissions/:slug/obligations/summary')
  @ApiSlugParam()
  @Roles(...COMMISSION_STAFF_ROLES, ...EACC_ROLES, PLATFORM_ADMIN)
  @ApiOperation({
    operationId: 'getCommissionObligationsSummary',
    summary: 'Counts by type and status, and not-onboarded among due and overdue',
    description:
      "A cycle's counts (the current cycle by default: the latest opened, or the next while none has): its biennials, open initial and final obligations, and those filed in the cycle's two years. Staff of the Commission, platform admins and EACC roles; staff of another Commission get 404.",
  })
  @ApiQueryParameters(summaryQuery)
  @ApiOkResponse({ description: 'The summary' })
  @ApiProblemResponse(400, 'Query failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  commissionSummary(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(summaryQuery)) query: SummaryQuery,
  ): Promise<CommissionSummary> {
    return this.commissions.summary(principal, slug, query);
  }

  @Get('commissions/:slug/obligations')
  @ApiSlugParam()
  @Roles(...COMMISSION_STAFF_ROLES, PLATFORM_ADMIN)
  @ApiOperation({
    operationId: 'listCommissionObligations',
    summary: 'Officers and their obligations for a Commission',
    description:
      'Staff of the tenant and platform-admin. EACC roles get 403 (summaries only); staff of another Commission 404.',
  })
  @ApiQueryParameters(listCommissionObligationsQuery)
  @ApiOkResponse({ description: 'Page ordered by due date, overdue first' })
  @ApiProblemResponse(400, 'Query failed validation, or the cursor is unknown')
  @ApiProblemResponse(404, NOT_VISIBLE)
  listCommissionObligations(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(listCommissionObligationsQuery))
    query: ListCommissionObligationsQuery,
  ): Promise<ObligationPage> {
    return this.commissions.list(principal, slug, query);
  }
}
