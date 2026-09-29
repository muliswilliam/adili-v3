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
  CurrentPrincipal,
  type Principal,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { TENANT_SLUG } from '../access.js';
import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import { ComplianceReportsService } from './compliance-reports.service.js';
import type { ComplianceReportSummary, ComplianceReportView } from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

/** reporting.yaml `FinancialYear`: the start year, e.g. 2027 for 1 July 2027 to 30 June 2028. */
const financialYear = z.coerce.number().int().min(FIRST_FINANCIAL_YEAR);

const ApiSlugParam = () =>
  ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_SLUG.source } });

const ApiFinancialYearParam = () =>
  ApiParam({
    name: 'fy',
    description: 'Financial year start year, e.g. 2027 for 1 July 2027 to 30 June 2028',
    schema: { type: 'integer', minimum: FIRST_FINANCIAL_YEAR },
  });

/**
 * A Commission's Form M workspace (spec 09): report periods, the report of a year, and compiling
 * it. Supervisors, commission-admins and reporting officers of the Commission; anyone else,
 * another Commission's staff and EACC included, gets 404.
 */
@ApiTags('form-m')
@Controller('v1/commissions/:slug/compliance-reports')
export class ComplianceReportsController {
  constructor(private readonly reports: ComplianceReportsService) {}

  @Get()
  @ApiSlugParam()
  @ApiOperation({
    operationId: 'listComplianceReports',
    summary: 'Report periods for the Commission with status per financial year',
  })
  @ApiOkResponse({ description: 'Periods' })
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<ComplianceReportSummary[]> {
    return this.reports.periods(principal, slug);
  }

  @Get(':fy')
  @ApiSlugParam()
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'getComplianceReport',
    summary: 'The report for a financial year (draft or submitted) with its document',
  })
  @ApiOkResponse({ description: 'Report' })
  @ApiProblemResponse(400, 'The financial year is not one reports exist for')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(503, 'The Commission directory could not be reached')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
  ): Promise<ComplianceReportView> {
    return this.reports.get(principal, slug, fy);
  }

  @Post(':fy/compile')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiSlugParam()
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'compileComplianceReport',
    summary: 'Compile a preview (from 1 April) or recompile a draft (supervisor)',
  })
  @ApiAcceptedResponse({ description: 'Compilation started' })
  @ApiProblemResponse(400, 'The financial year is not one reports exist for')
  @ApiProblemResponse(403, 'Only a supervisor compiles')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `preview-not-available` or `report-submitted`')
  compile(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
  ): Promise<void> {
    return this.reports.compile(principal, slug, fy);
  }
}
