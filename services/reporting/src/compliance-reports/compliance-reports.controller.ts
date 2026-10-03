import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiJsonBody,
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
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

const NOT_EDITABLE = 'Problem code `report-compiling` while a compile runs, or `report-submitted`';

const REPORT = schemaRef('ComplianceReport');

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
    description:
      'The current and previous financial year, every year with a report, and every year the projections hold obligations or clarifications for, from 2025, the latest first. A year without a report is `not-started`.',
  })
  @ApiOkResponse({
    description: 'Periods',
    schema: { type: 'array', items: schemaRef('ComplianceReportSummary') },
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<ComplianceReportSummary[]> {
    return this.reports.periods(principal, slug);
  }

  @Get(':fy')
  @AuditedRead({ action: 'compliance-report.viewed', resource: 'compliance-report' })
  @ApiSlugParam()
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'getComplianceReport',
    summary: 'The report for a financial year (draft or submitted) with its document',
    description:
      "Each read is audited (`audit.read.v1`, action `compliance-report.viewed`, under the Commission's tenant).",
  })
  @ApiOkResponse({ description: 'Report', schema: REPORT })
  @ApiProblemResponse(400, 'The financial year is not one reports exist for')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    503,
    'Problem type `directory-unavailable`: the Commission could not be named; try again',
  )
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
    description:
      "Marks the report `compiling` (creating it for a year that has none) and starts or signals the year's `ComplianceReportWorkflow`, which compiles from the projections as they are now. Remarks and manual fields are kept. Read the report with getComplianceReport until it leaves `compiling`.",
  })
  @ApiAcceptedResponse({ description: 'Compilation started' })
  @ApiProblemResponse(400, 'The financial year is not one reports exist for')
  @ApiProblemResponse(403, 'Only a supervisor compiles')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem code `report-submitted`, or `preview-not-available` before 1 April after the year',
  )
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
    description:
      'Remarks by obligation id, kept across recompiles. A blank remark returns the row to its default, the label of the latest action step taken.',
  })
  @ApiJsonBody(remarksBody)
  @ApiOkResponse({ description: 'Updated', schema: REPORT })
  @ApiProblemResponse(
    400,
    'Validation failed, or an obligation the draft does not list (paths in errors)',
  )
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
    description:
      "Each field given replaces the draft's; null clears it; fields left out are kept. Kept across recompiles. Part I contact details the commission-admin has not entered carry over from the Commission's previous submitted report.",
  })
  @ApiBody({ required: true, schema: schemaRef('ManualFields') })
  @ApiOkResponse({ description: 'Updated', schema: REPORT })
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
    description:
      'Part III "Compiled by" names the supervisor (their name from the token, the designation given) with today\'s date. A recompile returns the report to `draft` for review again.',
  })
  @ApiJsonBody(reviewedBody)
  @ApiOkResponse({ description: 'Reviewed', schema: REPORT })
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
    description:
      'Needs a token from the step-up re-authentication (`acr` `step-up`, `auth_time` at most 5 minutes old) and an Idempotency-Key. Part III "Confirmed by" names the commission-admin; the document must then be complete against form-m.v1. Allocates `RPT-<ISSUER>-<FY end>-<seq>-<check>`, freezes the document with its canonical SHA-256, marks the report `submitted` (`late` after 31 July) and records EACC\'s receipt. The Restricted Form M PDF and the signed receipt are issued through documents right after, and both officers are told: `formMDocumentId` and `receiptDocumentId` are null until then. The answer, kept for replays of the key, leaves `document` null: names live only in the encrypted report; read the report as filed with getComplianceReport.',
  })
  @ApiBody({ required: false, schema: schemaRef('ConfirmReport') })
  @ApiOkResponse({
    description: 'Submitted with its reference; the PDF and receipt follow',
    schema: REPORT,
  })
  @ApiProblemResponse(
    400,
    'Problem code `not-reviewed`, or `incomplete` with the paths in errors; or the Idempotency-Key is missing',
  )
  @ApiProblemResponse(403, 'Role, or problem code `step-up-required`')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, NOT_EDITABLE)
  @ApiProblemResponse(
    503,
    'The Commission directory or the workflow engine could not be reached; nothing submitted',
  )
  confirm(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
    @Body(new ZodValidationPipe(confirmBody)) body: ConfirmBody,
  ): Promise<ComplianceReportView> {
    return this.signOff.confirm(principal, slug, fy, body);
  }
}
