import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiJsonBody,
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  CurrentReadAudit,
  InternalApi,
  type Principal,
  type ReadAudit,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { REVIEW_INTERNAL_SCOPE } from '@adili/roles';

import { ClarificationDetailsService } from './clarification-details.service.js';
import {
  type ClarificationDetails,
  type ClarificationDetailsRequest,
  clarificationDetailsRequest,
} from './representation.js';

/**
 * Internal: not routed by the public entrypoint. The reporting service reads a Commission's
 * clarifications here when it compiles Form M (spec 09 #220).
 */
@ApiTags('internal')
@Controller('internal/v1/review/clarifications')
@InternalApi(REVIEW_INTERNAL_SCOPE)
export class ClarificationDetailsController {
  constructor(private readonly clarifications: ClarificationDetailsService) {}

  @Post('details')
  @HttpCode(200)
  @AuditedRead({ action: 'review.clarifications.details.read', resource: 'clarification' })
  @ApiJsonBody(clarificationDetailsRequest)
  @ApiOperation({
    operationId: 'internalClarificationDetails',
    summary: 'Clarifications of a Commission in a batch, for Form M section 4 (reporting, spec 09)',
  })
  @ApiOkResponse({
    description: 'The clarifications, one per known id',
    schema: {
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array', items: schemaRef('InternalClarificationDetails') } },
    },
  })
  @ApiProblemResponse(400, 'Body failed validation: no ids, more than 1,000, or one not a UUID')
  async details(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Body(new ZodValidationPipe(clarificationDetailsRequest)) body: ClarificationDetailsRequest,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<{ items: ClarificationDetails[] }> {
    const details = await this.clarifications.details(
      { tenant, subject: principal.subject },
      body.clarificationIds,
    );
    // The trail names the clarifications read, not the ids asked for.
    audit.resource({ tenant, ids: details.items.map((item) => item.clarificationId) });
    return details;
  }
}
