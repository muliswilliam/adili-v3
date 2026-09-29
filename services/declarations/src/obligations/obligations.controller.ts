import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { COMMISSION_STAFF_ROLES, EACC_ROLES, PLATFORM_ADMIN, TENANT_SLUG } from './access.js';
import { CommissionObligationsService } from './commission-obligations.service.js';
import {
  type ListCommissionObligationsQuery,
  listCommissionObligationsQuery,
  type SummaryQuery,
  summaryQuery,
} from './commission-query.js';
import { ObligationsService } from './obligations.service.js';
import type {
  CommissionSummary,
  MyObligations,
  NationalSummary,
  ObligationDetail,
  ObligationPage,
} from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

/** The `slug` path parameter, as the contract's `Slug`. */
const ApiSlugParam = () =>
  ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_SLUG.source } });

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
  @ApiOkResponse({
    description: 'Obligations grouped by Commission',
    schema: schemaRef('MyObligations'),
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  mine(@CurrentPrincipal() principal: Principal): Promise<MyObligations> {
    return this.obligations.mine(principal);
  }

  @Get('obligations/summary')
  @Roles(...EACC_ROLES, PLATFORM_ADMIN)
  @ApiOperation({
    operationId: 'getNationalObligationsSummary',
    summary: 'Per-Commission counts for EACC and platform administrators',
    description:
      "Every Commission's counts for a cycle (the current one by default), with not-onboarded declarants due or overdue, the last roster import, and totals. No declarant data.",
  })
  @ApiQueryParameters(summaryQuery)
  @ApiOkResponse({
    description: 'Counts per Commission and totals',
    schema: schemaRef('NationalSummary'),
  })
  @ApiProblemResponse(400, 'Query failed validation')
  @ApiProblemResponse(403, 'Only EACC roles and platform admins')
  nationalSummary(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(summaryQuery)) query: SummaryQuery,
  ): Promise<NationalSummary> {
    return this.commissions.national(principal, query);
  }

  @Get('obligations/:id')
  @AuditedRead({ action: 'obligation.viewed', resource: 'filing-obligation' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getObligation',
    summary: 'One obligation with its reminder history',
    description:
      "The declarant's own (`declarant` null); staff of the obligation's Commission and platform admins (with `declarant`, whom it is for). Anyone else gets 404.",
  })
  @ApiOkResponse({ description: 'The obligation', schema: schemaRef('ObligationDetail') })
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
  @ApiOkResponse({ description: 'The summary', schema: schemaRef('CommissionSummary') })
  @ApiProblemResponse(400, 'Query failed validation')
  @ApiProblemResponse(403, "Not a Commission's staff, an EACC role or a platform admin")
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
  @AuditedRead({ action: 'obligations.listed', resource: 'filing-obligation' })
  @ApiOperation({
    operationId: 'listCommissionObligations',
    summary: 'Declarants and their obligations for a Commission',
    description:
      'Staff of the tenant and platform-admin. EACC roles get 403 (summaries only); staff of another Commission 404.',
  })
  @ApiQueryParameters(listCommissionObligationsQuery)
  @ApiOkResponse({
    description: 'Page ordered by due date, overdue first',
    schema: schemaRef('ObligationPage'),
  })
  @ApiProblemResponse(400, 'Query failed validation, or the cursor is unknown')
  @ApiProblemResponse(403, "Not a Commission's staff or a platform admin (EACC sees counts only)")
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
