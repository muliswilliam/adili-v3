import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
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
  RequireIdempotencyKey,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { TENANT_SLUG } from '../access.js';
import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import { ComplianceReportsService } from './compliance-reports.service.js';
import { ReportSignOffService } from './report-sign-off.service.js';
import type { ComplianceReportSummary, ComplianceReportView } from './representation.js';
import {
  type ConfirmBody,
  confirmBody,
  type ManualFieldsBody,
  manualFieldsBody,
  type RemarksBody,
  remarksBody,
  type ReviewedBody,
  reviewedBody,
} from './sign-off-input.js';

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

const NOT_EDITABLE = 'Problem code `report-compiling` or `report-submitted`';

/**
 * A Commission's Form M workspace (spec 09): report periods, the report of a year, compiling it,
 * and its review and sign-off. Supervisors, commission-admins and reporting officers of the
 * Commission; anyone else, another Commission's staff and EACC included, gets 404.
 */
@ApiTags('form-m')
@Controller('v1/commissions/:slug/compliance-reports')
export class ComplianceReportsController {
  constructor(
    private readonly reports: ComplianceReportsService,
    private readonly signOff: ReportSignOffService,
  ) {}

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

  @Patch(':fy/remarks')
  @ApiSlugParam()
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'updateReportRemarks',
    summary: 'Edit remarks on non-filer rows (supervisor)',
  })
  @ApiOkResponse({ description: 'Updated' })
  @ApiProblemResponse(400, 'Validation failed, or an obligation the draft does not list')
  @ApiProblemResponse(403, 'Only a supervisor edits remarks')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, NOT_EDITABLE)
  updateRemarks(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
    @Body(new ZodValidationPipe(remarksBody)) body: RemarksBody,
  ): Promise<ComplianceReportView> {
    return this.signOff.updateRemarks(principal, slug, fy, body);
  }

  @Patch(':fy/manual')
  @ApiSlugParam()
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'updateReportManualFields',
    summary: 'Edit Part I contact details and Part B complaints (commission-admin)',
  })
  @ApiOkResponse({ description: 'Updated' })
  @ApiProblemResponse(400, 'Validation failed')
  @ApiProblemResponse(403, 'Only a commission-admin enters Part I and Part B')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, NOT_EDITABLE)
  updateManualFields(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
    @Body(new ZodValidationPipe(manualFieldsBody)) body: ManualFieldsBody,
  ): Promise<ComplianceReportView> {
    return this.signOff.updateManualFields(principal, slug, fy, body);
  }

  @Post(':fy/reviewed')
  @HttpCode(HttpStatus.OK)
  @ApiSlugParam()
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'markReportReviewed',
    summary: 'Supervisor marks the draft reviewed (records Part III compiled-by)',
  })
  @ApiOkResponse({ description: 'Reviewed' })
  @ApiProblemResponse(400, 'Validation failed')
  @ApiProblemResponse(403, 'Only a supervisor marks the draft reviewed')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, NOT_EDITABLE)
  markReviewed(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
    @Body(new ZodValidationPipe(reviewedBody)) body: ReviewedBody,
  ): Promise<ComplianceReportView> {
    return this.signOff.markReviewed(principal, slug, fy, body);
  }

  @Post(':fy/confirm')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ApiSlugParam()
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'confirmComplianceReport',
    summary: 'Commission-admin confirms and submits to EACC (step-up token required)',
  })
  @ApiOkResponse({ description: 'Submitted with reference; PDF and receipt follow' })
  @ApiProblemResponse(400, 'Problem code `not-reviewed` or `incomplete` (paths in errors)')
  @ApiProblemResponse(403, 'Role, or problem code `step-up-required`')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, NOT_EDITABLE)
  @ApiProblemResponse(503, 'The directory or the workflow engine could not be reached')
  confirm(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
    @Body(new ZodValidationPipe(confirmBody)) body: ConfirmBody,
  ): Promise<ComplianceReportView> {
    return this.signOff.confirm(principal, slug, fy, body);
  }
}
