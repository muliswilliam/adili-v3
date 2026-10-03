import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
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
  })
  @ApiBody({
    description: 'A form-m.v1 document (see forms/form-m.v1.json)',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiCreatedResponse({ description: 'Submitted with its reference; the PDF and receipt follow' })
  @ApiProblemResponse(
    400,
    'Problem code `invalid-document` (schema) or `inconsistent-document` (business rules), paths in errors',
  )
  @ApiProblemResponse(403, 'Scope missing, or problem code `tenant-mismatch`')
  @ApiProblemResponse(409, 'Problem code `report-submitted`: the year is filed already')
  @ApiProblemResponse(503, 'The directory or the workflow engine could not be reached')
  submit(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ): Promise<ComplianceReportView> {
    return this.signOff.submitFederated(principal, body);
  }
}
