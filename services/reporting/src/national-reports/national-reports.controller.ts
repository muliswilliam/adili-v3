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
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiJsonBody,
  ApiProblemResponse,
  CurrentPrincipal,
  IdempotencyKey,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import type { PatternCandidate } from './candidates.js';
import { type Narrative, narrativeSchema } from './narrative.js';
import { type DraftRequest, NarrativeDraftService } from './narrative-draft.service.js';
import { NationalReportsService } from './national-reports.service.js';
import type { NationalReportView } from './representation.js';
import { DRAFT_SCOPES } from './schema.js';

/** reporting.yaml `FinancialYear`: the start year, e.g. 2027 for 1 July 2027 to 30 June 2028. */
const financialYear = z.coerce.number().int().min(FIRST_FINANCIAL_YEAR);

/** The part of Fastify's reply the draft route uses. */
interface Reply {
  status(code: number): unknown;
}

/** reporting.yaml `draftNationalReportNarrative` body. */
const draftBody = z.strictObject({
  section: z.enum(DRAFT_SCOPES),
  replaceAll: z.boolean().meta({
    description:
      'Replace every paragraph of the section; default replaces only paragraphs still marked as AI draft',
  }),
});

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
    description:
      "eacc-analyst and eacc-supervisor (tenant `eacc`); anyone else 403. 404 until the year's report is first built. `aggregates` holds counts and rates only: `reporting` (Commissions reported on time, late, not reported), `national` (per section expected, declared, not declared and rate, the three together as `all`, clarifications, access requests) and `byCommission` (per Commission slug: name, status, report id and reference, and its numbers once reported). Narrative paragraphs cite figures in `aggregateRefs` by aggregate key in the ai-gateway scheme, as `PatternCandidate.aggregateKeys` does, not by dot path into `aggregates`. Reading the report is how a narrative draft answered 202 is polled, so this GET can write: a `narrativeDraft` still `drafting` is looked up at the ai-gateway first (a call per job) and, once its jobs have ended, settled under the report's lock before the report is answered: inserted (`inserted`: its AI-draft paragraphs written into the narrative, the requester made a contributor, `ncr.narrative-drafted.v1` emitted) or discarded (`failed` with its reason). Settled once, whichever read or retry gets there first. While the gateway cannot be reached the report is answered with the draft still `drafting`, unchanged.",
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

  @Get(':fy/candidates')
  @ApiFinancialYearParam()
  @ApiOperation({
    operationId: 'getNationalReportCandidates',
    summary:
      "Deterministic pattern candidates computed from this and prior years' aggregates (analyst)",
    description:
      "Computed from the year's aggregates as last built and those of the prior years built, at the configured thresholds (`CANDIDATE_*`), ordered by kind, then the largest first (a rate change's points either way, a breaching rate, a run's years, the factor over the national clarification ratio, the points above the size band), then subject (`national` first on a tie). Values by kind: `rate-change` {from, to, change, factor} of a non-filer rate year on year (the filing rate's complement); `threshold-breach` {nonFilerRate, threshold}; `chronic-late-reporting` {years} of reports submitted late running; `clarification-ratio-outlier` {clarificationRatio, nationalRatio, factor}; `size-band-outlier` {nonFilerRate, peerNonFilerRate, peers, bandFrom, bandTo} against the other Commissions with as many officers expected; `non-reporting` {years} without a report running. EACC analysts and supervisors only; anyone else 403. 404 until the year's report is first built.",
  })
  @ApiOkResponse({
    description: 'Candidates',
    schema: { type: 'array', items: schemaRef('PatternCandidate') },
  })
  @ApiProblemResponse(400, FY_INVALID)
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
    description:
      "eacc-analyst and eacc-supervisor; anyone else 403. The ai-gateway's `narrate-compliance-report` task gets the year's figures (national totals and rates, the per-Commission table, prior years) and pattern candidates only, data class `restricted`, and the request waits up to 20 s for it. A draft of `findings`, or of `all`, needs at least one pattern candidate (the task narrates a finding only from one): with none, `all` drafts the overview and the recommendations (a task call each, findings left as they are), and `findings` is 409 `no-pattern-candidates`. Ready by then: its paragraphs are inserted with `aiDraft: true`, their `aggregateRefs` and `candidateIds` (200). Not ready: 202 with `narrativeDraft.status` `drafting`; poll `getNationalReport`, which inserts it once the job has ended. In each section drafted, the new paragraphs replace those still marked as AI drafts (where the first of them stood), and paragraphs the analyst edited or typed stay; `replaceAll` replaces the whole section. Editing a paragraph through `updateNationalReportNarrative` clears its `aiDraft`. The requester becomes a contributor (who cannot approve) and `ncr.narrative-drafted.v1` is emitted (report id, year, section, job ids; no figures). A new request replaces a draft still being written, whose job is then never inserted; a draft that ends after the aggregates were rebuilt is discarded. A retry with the same Idempotency-Key reads the same job, and inserts it once.",
  })
  @ApiJsonBody(draftBody)
  @ApiOkResponse({ description: 'Draft inserted', schema: NCR })
  @ApiAcceptedResponse({ description: 'Still drafting; poll the report', schema: NCR })
  @ApiProblemResponse(
    400,
    'Body failed validation, Idempotency-Key missing, or fy is not a financial year',
  )
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(404, 'Not built yet')
  @ApiProblemResponse(
    409,
    "Nothing inserted. Problem code `ncr-approved` (the report no longer changes), `narrative-validation` (the draft cited a figure not in the input and was discarded), `ai-not-enabled` (the ai-gateway's gate does not let EACC's data be sent), `no-pattern-candidates` (findings with no candidate to narrate) or `aggregates-rebuilt` (the report was rebuilt while the draft was written)",
  )
  @ApiProblemResponse(
    502,
    "Problem code `narrative-draft-failed`: the ai-gateway refused the request or the job failed (`reason`: the job's reason, e.g. `provider`, `budget`, `timeout`); nothing inserted",
  )
  @ApiProblemResponse(503, 'The ai-gateway could not be reached; nothing was asked of it')
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
