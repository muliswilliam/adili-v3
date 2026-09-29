import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import { EaccReportsService } from './eacc-reports.service.js';
import type { IntakeFilters, IntakeView } from './intake.js';
import type { ComplianceReportView } from './representation.js';

const intakeQuery = z.object({
  fy: z.coerce.number().int().min(FIRST_FINANCIAL_YEAR),
  status: z.enum(['not-reported', 'submitted-on-time', 'submitted-late']).optional(),
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
 * report is audited (ADR-008).
 */
@ApiTags('eacc')
@Controller('v1/eacc/compliance-reports')
export class EaccReportsController {
  constructor(private readonly reports: EaccReportsService) {}

  @Get()
  @ApiOperation({
    operationId: 'getEaccIntake',
    summary: 'Per-Commission report status, rates and outliers for a financial year (EACC roles)',
  })
  @ApiQuery({ name: 'fy', schema: { type: 'integer', minimum: FIRST_FINANCIAL_YEAR } })
  @ApiQuery({ name: 'status', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'outliersOnly', required: false, schema: { type: 'boolean' } })
  @ApiOkResponse({ description: 'Intake' })
  @ApiProblemResponse(400, 'Query failed validation')
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
    summary: 'A submitted report as filed, with its PDF and receipt ids',
  })
  @ApiOkResponse({ description: 'Report' })
  @ApiProblemResponse(400, 'reportId is not a UUID')
  @ApiProblemResponse(404, 'Not found, not submitted, or not visible to the caller')
  @ApiProblemResponse(503, 'The Commission directory could not be reached')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('reportId', new ZodValidationPipe(z.uuid())) reportId: string,
  ): Promise<ComplianceReportView> {
    return this.reports.submittedReport(principal, reportId);
  }
}
