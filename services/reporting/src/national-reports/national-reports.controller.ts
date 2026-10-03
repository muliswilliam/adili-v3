import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import { type Narrative, narrativeSchema } from './narrative.js';
import { NationalReportsService } from './national-reports.service.js';
import type { NationalReportView } from './representation.js';

/** reporting.yaml `FinancialYear`: the start year, e.g. 2027 for 1 July 2027 to 30 June 2028. */
const financialYear = z.coerce.number().int().min(FIRST_FINANCIAL_YEAR);

const ApiFinancialYearParam = () =>
  ApiParam({
    name: 'fy',
    description: 'Financial year start year, e.g. 2027 for 1 July 2027 to 30 June 2028',
    schema: { type: 'integer', minimum: FIRST_FINANCIAL_YEAR },
  });

const EACC_ONLY = 'Only EACC analysts and supervisors';
const APPROVED = 'Problem code `ncr-approved`: the report no longer changes';
const NCR = schemaRef('NationalReport');
const FY_INVALID = 'fy is not a financial year';

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
    description:
      "eacc-analyst and eacc-supervisor (tenant `eacc`); anyone else 403. 404 until the year's report is first built. `aggregates` holds counts and rates only: `reporting` (Commissions reported on time, late, not reported), `national` (per section expected, declared, not declared and rate, the three together as `all`, clarifications, access requests) and `byCommission` (per Commission slug: name, status, report id and reference, and its numbers once reported). Narrative paragraphs cite figures in `aggregateRefs` by aggregate key in the ai-gateway scheme, as `PatternCandidate.aggregateKeys` does, not by dot path into `aggregates`.",
  })
  @ApiOkResponse({ description: 'NCR', schema: NCR })
  @ApiProblemResponse(400, FY_INVALID)
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
    description:
      "eacc-analyst and eacc-supervisor; anyone else 403. Recomputes the aggregates from the Commissions' submitted reports as filed and every active Commission the directory lists; the narrative is kept. The first build makes the caller the author. Every build and narrative save raises `version` and adds the caller to the report's contributors, who cannot approve it. Emits `ncr.drafted.v1` (ids, year, version, status, reports included).",
  })
  @ApiOkResponse({ description: 'Built', schema: NCR })
  @ApiProblemResponse(400, FY_INVALID)
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
    description:
      "eacc-analyst and eacc-supervisor; anyone else 403. Every section's full text, paragraphs separated by a blank line; stored as `narrativeParagraphs`. A paragraph whose text is unchanged keeps its id and labels; an edited one keeps its id and loses `aiDraft`; the rest are new. The caller becomes a contributor. 404 before the first build.",
  })
  @ApiBody({ required: true, schema: schemaRef('Narrative') })
  @ApiOkResponse({ description: 'Saved', schema: NCR })
  @ApiProblemResponse(400, 'Body failed validation, or fy is not a financial year')
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(404, 'Not built yet')
  @ApiProblemResponse(409, APPROVED)
  saveNarrative(
    @CurrentPrincipal() principal: Principal,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
    @Body(new ZodValidationPipe(narrativeSchema)) body: Narrative,
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
    description:
      "eacc-supervisor only; eacc-analyst and anyone else 403. The author, or anyone who built the report or saved its narrative, gets 403 `separation-of-duties`. Allocates `NCR-EACC-<FY end>-<seq>-<check>`, freezes the report and emits `ncr.approved.v1` (ids, year, version, reference). The Restricted PDF follows (`documentId`, polled on the report), and the year's chase of non-reporting Commissions ends. A retry with the same Idempotency-Key replays the approval; another approval of an approved report is 409 `ncr-approved` and allocates nothing.",
  })
  @ApiOkResponse({ description: 'Approved with its reference; the PDF follows', schema: NCR })
  @ApiProblemResponse(400, 'Idempotency-Key missing, or fy is not a financial year')
  @ApiProblemResponse(403, 'Role, or problem code `separation-of-duties`')
  @ApiProblemResponse(404, 'Not built yet')
  @ApiProblemResponse(409, APPROVED)
  @ApiProblemResponse(503, 'The workflow engine could not be reached; nothing was approved')
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
  ): Promise<NationalReportView> {
    return this.reports.approve(principal, fy);
  }
}
