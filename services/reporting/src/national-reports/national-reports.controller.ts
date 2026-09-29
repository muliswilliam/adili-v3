import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import type { Narrative } from './narrative.js';
import { NationalReportsService } from './national-reports.service.js';
import type { NationalReportView } from './representation.js';

/** reporting.yaml `FinancialYear`: the start year, e.g. 2027 for 1 July 2027 to 30 June 2028. */
const financialYear = z.coerce.number().int().min(FIRST_FINANCIAL_YEAR);

/** reporting.yaml `Narrative`: each section's text, paragraphs separated by a blank line. */
const narrativeBody = z.strictObject({
  overview: z.string().max(20_000),
  findings: z.string().max(40_000),
  recommendations: z.string().max(20_000),
});

const ApiFinancialYearParam = () =>
  ApiParam({
    name: 'fy',
    description: 'Financial year start year, e.g. 2027 for 1 July 2027 to 30 June 2028',
    schema: { type: 'integer', minimum: FIRST_FINANCIAL_YEAR },
  });

const EACC_ONLY = 'Only EACC analysts and supervisors';
const APPROVED = 'Problem code `ncr-approved`: the report no longer changes';

/**
 * EACC's national consolidated report (spec 09 NCR): read, build from the submitted reports,
 * save the narrative (EACC analysts and supervisors; everyone else 403), and approve (an EACC
 * supervisor who did not write it).
 */
@ApiTags('ncr')
@Controller('v1/eacc/national-reports')
export class NationalReportsController {
  constructor(private readonly reports: NationalReportsService) {}

  @Get(':fy')
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'getNationalReport',
    summary: 'The national consolidated report for a financial year',
  })
  @ApiOkResponse({ description: 'NCR' })
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(404, 'Not built yet')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
  ): Promise<NationalReportView> {
    return this.reports.get(principal, fy);
  }

  @Post(':fy/build')
  @HttpCode(HttpStatus.OK)
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'buildNationalReport',
    summary: 'Build or rebuild aggregates from submitted reports (analyst); narrative preserved',
  })
  @ApiOkResponse({ description: 'Built' })
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(409, 'Problem code `no-submitted-reports` or `ncr-approved`')
  @ApiProblemResponse(503, 'The Commission directory could not be reached')
  build(
    @CurrentPrincipal() principal: Principal,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
  ): Promise<NationalReportView> {
    return this.reports.build(principal, fy);
  }

  @Patch(':fy/narrative')
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'updateNationalReportNarrative',
    summary: 'Save narrative sections (analyst)',
  })
  @ApiOkResponse({ description: 'Saved' })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(404, 'Not built yet')
  @ApiProblemResponse(409, APPROVED)
  saveNarrative(
    @CurrentPrincipal() principal: Principal,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
    @Body(new ZodValidationPipe(narrativeBody)) body: Narrative,
  ): Promise<NationalReportView> {
    return this.reports.saveNarrative(principal, fy, body);
  }

  @Post(':fy/approve')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'approveNationalReport',
    summary: 'EACC supervisor (not the author) approves; allocates NCR and issues the PDF',
  })
  @ApiOkResponse({ description: 'Approved with its reference; the PDF follows' })
  @ApiProblemResponse(403, 'Role, or problem code `separation-of-duties`')
  @ApiProblemResponse(404, 'Not built yet')
  @ApiProblemResponse(409, APPROVED)
  @ApiProblemResponse(503, 'The workflow engine could not be reached')
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
  ): Promise<NationalReportView> {
    return this.reports.approve(principal, fy);
  }
}
