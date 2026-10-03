import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  CurrentReadAudit,
  type Principal,
  type ReadAudit,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import { EaccReportsService } from './eacc-reports.service.js';
import { INTAKE_STATUSES, type IntakeFilters, type IntakeView } from './intake.js';
import type { ComplianceReportView } from './representation.js';

const intakeQuery = z.object({
  fy: z.coerce.number().int().min(FIRST_FINANCIAL_YEAR),
  status: z.enum(INTAKE_STATUSES).optional(),
  outliersOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
type IntakeQuery = z.infer<typeof intakeQuery>;

/**
 * EACC's intake of Form M (spec 09): which Commissions have reported for a financial year, on
 * time or late, their rates and outliers, and how often they were chased (EACC roles; everyone
 * else 403); and the report viewer, a submitted report as filed (EACC roles for every
 * Commission's, a Commission's staff and system for their own; everyone else 404). Reading a
 * report is audited (ADR-008) under the Commission whose report it is.
 */
@ApiTags('eacc')
@Controller('v1/eacc/compliance-reports')
export class EaccReportsController {
  constructor(private readonly reports: EaccReportsService) {}

  @Get()
  @ApiOperation({
    operationId: 'getEaccIntake',
    summary: 'Per-Commission report status, rates and outliers for a financial year (EACC roles)',
    description:
      "eacc-analyst and eacc-supervisor (tenant `eacc`); anyone else 403. Every active Commission the directory lists (and any other that filed), by name: `not-reported`, or submitted on time or late (after 31 July) from EACC's receipt, with the report's reference, the ids of its Form M PDF and receipt once issued, declared / expected per section from the report's counts, outliers, and how often and when it was last chased. Outliers: `low-<section>-rate` when officers were expected and the declared rate is below the section's configured threshold (`INTAKE_MIN_<SECTION>_RATE`, 0.8 by default); `section-missing` when a section's counts are absent, or no officer in service is expected in a year with a biennial cycle. The totals cover the year whatever the filters; `nationalDeclaredRate` is declared over expected across the submitted reports' sections.",
  })
  @ApiQuery({
    name: 'fy',
    description: 'Financial year start year, e.g. 2027 for 1 July 2027 to 30 June 2028',
    schema: { type: 'integer', minimum: FIRST_FINANCIAL_YEAR },
  })
  @ApiQuery({ name: 'status', required: false, schema: schemaRef('IntakeStatus') })
  @ApiQuery({ name: 'outliersOnly', required: false, schema: { type: 'boolean' } })
  @ApiOkResponse({ description: 'Intake', schema: schemaRef('Intake') })
  @ApiProblemResponse(
    400,
    'Query failed validation (a year reports do not exist for, an unknown status)',
  )
  @ApiProblemResponse(403, 'Only EACC analysts and supervisors')
  @ApiProblemResponse(503, 'The Commission directory could not be reached')
  intake(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(intakeQuery)) query: IntakeQuery,
  ): Promise<IntakeView> {
    const filters: IntakeFilters = {};
    if (query.status !== undefined) filters.status = query.status;
    if (query.outliersOnly !== undefined) filters.outliersOnly = query.outliersOnly;
    return this.reports.intake(principal, query.fy, filters);
  }

  @Get(':reportId')
  @AuditedRead({ action: 'compliance-report.viewed', resource: 'compliance-report' })
  @ApiParam({ name: 'reportId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getSubmittedReport',
    summary: 'A submitted report as filed, with its PDF and receipt ids (report viewer)',
    description:
      "eacc-analyst and eacc-supervisor (tenant `eacc`) read every Commission's submitted report; a Commission's supervisor, commission-admin and reporting officer, and its own system (`reports:submit`), read their own. Anyone else, another Commission's report, a report not submitted and an unknown id are 404. The document is the frozen `form-m.v1` as filed; the PDF and receipt download through documents by `formMDocumentId` and `receiptDocumentId` (null until issued). Each read is audited (`audit.read.v1`, action `compliance-report.viewed`) under the tenant of the Commission whose report it is.",
  })
  @ApiOkResponse({ description: 'Report', schema: schemaRef('SubmittedComplianceReport') })
  @ApiProblemResponse(400, 'reportId is not a UUID')
  @ApiProblemResponse(404, 'Not found, not submitted, or not visible to the caller')
  @ApiProblemResponse(503, 'The Commission directory could not be reached')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('reportId', new ZodValidationPipe(z.uuid())) reportId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<ComplianceReportView> {
    return this.reports.submittedReport(principal, reportId, audit);
  }
}
