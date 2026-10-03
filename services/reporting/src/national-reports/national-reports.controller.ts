import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
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
  IdempotencyKey,
  type Principal,
  RequireIdempotencyKey,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import type { PatternCandidate } from './candidates.js';
import type { Narrative } from './narrative.js';
import { type DraftRequest, NarrativeDraftService } from './narrative-draft.service.js';
import { NationalReportsService } from './national-reports.service.js';
import type { NationalReportView } from './representation.js';
import { DRAFT_SCOPES } from './schema.js';

/** reporting.yaml `FinancialYear`: the start year, e.g. 2027 for 1 July 2027 to 30 June 2028. */
const financialYear = z.coerce.number().int().min(FIRST_FINANCIAL_YEAR);

/** reporting.yaml `Narrative`: each section's text, paragraphs separated by a blank line. */
const narrativeBody = z.strictObject({
  overview: z.string().max(20_000),
  findings: z.string().max(40_000),
  recommendations: z.string().max(20_000),
});

/** The part of Fastify's reply the draft route uses. */
interface Reply {
  status(code: number): unknown;
}

/** reporting.yaml `draftNationalReportNarrative` body. */
const draftBody = z.strictObject({
  section: z.enum(DRAFT_SCOPES),
  replaceAll: z.boolean(),
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
 * EACC's national consolidated report (spec 09 NCR): read, its pattern candidates (spec 09b),
 * build from the submitted reports, save the narrative and have it AI-drafted (spec 09b; EACC
 * analysts and supervisors; everyone else 403), and approve (an EACC supervisor who did not
 * write it).
 */
@ApiTags('ncr')
@Controller('v1/eacc/national-reports')
export class NationalReportsController {
  constructor(
    private readonly reports: NationalReportsService,
    private readonly drafts: NarrativeDraftService,
  ) {}

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

  @Get(':fy/candidates')
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'getNationalReportCandidates',
    summary:
      "Deterministic pattern candidates computed from this and prior years' aggregates (analyst)",
  })
  @ApiOkResponse({ description: 'Candidates' })
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(404, 'Not built yet')
  candidates(
    @CurrentPrincipal() principal: Principal,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
  ): Promise<PatternCandidate[]> {
    return this.reports.candidates(principal, fy);
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

  @Post(':fy/narrative/draft')
  @HttpCode(HttpStatus.OK)
  // A draft still being written is not a final answer: a retry reads the same job again.
  @RequireIdempotencyKey({
    settled: (body: NationalReportView) => body.narrativeDraft?.status !== 'drafting',
  })
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'draftNationalReportNarrative',
    summary:
      'AI-draft the narrative (all or one section) from aggregates and candidates; inserted as AI-draft paragraphs the analyst edits',
  })
  @ApiOkResponse({ description: 'Draft inserted' })
  @ApiAcceptedResponse({ description: 'Still drafting; poll the report' })
  @ApiProblemResponse(400, 'Body failed validation, or Idempotency-Key missing')
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(404, 'Not built yet')
  @ApiProblemResponse(
    409,
    'Problem code `ncr-approved`, `narrative-validation`, `ai-not-enabled`, `no-pattern-candidates` or `aggregates-rebuilt`',
  )
  @ApiProblemResponse(502, 'Problem code `narrative-draft-failed`')
  @ApiProblemResponse(503, 'The AI gateway could not be reached')
  async draftNarrative(
    @CurrentPrincipal() principal: Principal,
    @Param('fy', new ZodValidationPipe(financialYear)) fy: number,
    @Body(new ZodValidationPipe(draftBody)) body: DraftRequest,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<NationalReportView> {
    const { report, drafting } = await this.drafts.draft(principal, fy, body, key);
    if (drafting) void reply.status(HttpStatus.ACCEPTED);
    return report;
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
  @ApiProblemResponse(400, 'Idempotency-Key missing')
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
