import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  Scopes,
} from '@adili/api-kit';
import { REPORTS_SUBMIT_SCOPE } from '@adili/roles';

import { ReportSignOffService } from './report-sign-off.service.js';
import type { ComplianceReportView } from './representation.js';

/**
 * Federated submission (spec 09): a Commission running its own system files the `form-m.v1`
 * document with a client-credentials token (`reports:submit`, `tenant` = the Commission) and an
 * `Idempotency-Key`, and gets the same reference, PDF and receipt as a hosted Commission.
 */
@ApiTags('federated')
@Controller('v1/compliance-reports')
export class FederatedReportsController {
  constructor(private readonly signOff: ReportSignOffService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Scopes(REPORTS_SUBMIT_SCOPE)
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'submitComplianceReport',
    summary: 'Federated Commission submits a form-m.v1 document (reports:submit scope)',
    description:
      "For a Commission running its own system: a client-credentials token with scope `reports:submit` whose `tenant` claim is the Commission, and an Idempotency-Key. The document is validated against form-m.v1 (`invalid-document`), must name the token's Commission in Part I `issuerCode` (`tenant-mismatch`) and keep the business rules (`inconsistent-document`): the period is the financial year it names, 1 July to 30 June, open for reports (from 1 April of its last half); per section declared plus not declared is expected and the non-filers listed are as many as not declared; access requests granted plus declined are at most received and the decline reasons count at least every decline (a denial citing several grounds counts under each); Part III names who compiled and who confirmed, with dates. The report is then submitted as a hosted confirm submits it, with `source` `federated`: `RPT-<ISSUER>-<FY end>-<seq>-<check>`, the document frozen with its canonical SHA-256 (`meta.reference` and `meta.source` set by the platform), `late` after 31 July, EACC's receipt, and right after the Restricted Form M PDF, the signed receipt and the officers' emails (`formMDocumentId` and `receiptDocumentId` are null until then). A draft compiled on the platform for the year is superseded. The answer, kept for replays of the key, leaves `document` null.",
  })
  @ApiBody({ required: true, schema: schemaRef('FormM') })
  @ApiCreatedResponse({
    description: 'Submitted with its reference; the PDF and receipt follow',
    schema: schemaRef('ComplianceReport'),
  })
  @ApiProblemResponse(
    400,
    'Problem code `invalid-document` (schema) or `inconsistent-document` (business rules), paths in errors; or the Idempotency-Key is missing',
  )
  @ApiProblemResponse(
    403,
    'Scope `reports:submit` missing, the token names no Commission, or problem code `tenant-mismatch` (the document names another Commission)',
  )
  @ApiProblemResponse(
    409,
    "Problem code `report-submitted`: the Commission's report for this financial year is submitted already",
  )
  @ApiProblemResponse(
    503,
    'The Commission directory or the workflow engine could not be reached; nothing submitted',
  )
  submit(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ): Promise<ComplianceReportView> {
    return this.signOff.submitFederated(principal, body);
  }
}
