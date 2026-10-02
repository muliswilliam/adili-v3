import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ActingSubject,
  ActingTenant,
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  CurrentReadAudit,
  InternalApi,
  type Principal,
  type ReadAudit,
  ZodValidationPipe,
} from '@adili/api-kit';
import { REVIEW_DISCLOSURES_SCOPE } from '@adili/roles';
import { z } from 'zod';

import { ClarificationDisclosureService } from './clarification-disclosure.service.js';
import {
  type ClarificationCounts,
  type ClarificationCountsRequest,
  clarificationCountsRequest,
  type ClarificationDisclosure,
  type ClarificationDisclosureRequest,
  clarificationDisclosureRequest,
} from './disclosure.js';

/**
 * Internal: not routed by the public entrypoint. The access service (spec 10) asks here for the
 * clarifications a Form K grant discloses with the declarations (Act s.36(1), Regulation 22(1));
 * nothing else in the platform reads a declarant's clarifications for a third party. Every read
 * is audited (ADR-008) like declarations' disclosure: the legal basis, the grant reference, the
 * recipient and the clarifications served.
 */
@ApiTags('internal')
@Controller('internal/v1/review/clarifications')
@InternalApi(REVIEW_DISCLOSURES_SCOPE)
export class ClarificationDisclosureController {
  constructor(private readonly clarifications: ClarificationDisclosureService) {}

  @Post('disclosures')
  @HttpCode(HttpStatus.OK)
  @AuditedRead({ action: 'clarification.disclosed', resource: 'clarification' })
  @ApiHeader({
    name: 'X-Acting-Subject',
    required: true,
    description: 'The access officer who decided the grant; recorded in the audit event',
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiBody({ schema: z.toJSONSchema(clarificationDisclosureRequest) as object })
  @ApiOperation({
    operationId: 'internalDiscloseClarifications',
    summary: 'The clarifications an access grant discloses with the declarations (audited)',
  })
  @ApiOkResponse({ description: 'The clarifications in the granted scope, oldest issued first' })
  @ApiProblemResponse(
    400,
    'Body failed validation, a legal basis that does not go with the grant reference, or no X-Acting-Subject',
  )
  async disclose(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @ActingSubject(new ZodValidationPipe(z.string().min(1).max(255))) _actingSubject: string,
    @Body(new ZodValidationPipe(clarificationDisclosureRequest))
    request: ClarificationDisclosureRequest,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<ClarificationDisclosure> {
    const { disclosure, clarificationIds } = await this.clarifications.disclose(
      { tenant, subject: principal.subject },
      request,
    );
    // The clarifications that left, by id: investigators can tell which were disclosed.
    audit.resource({ tenant, subjectPersonId: request.personId, ids: clarificationIds });
    audit.disclosure({
      basis: request.legalBasis,
      reference: request.grantReference,
      recipient: request.recipientSubject,
    });
    return disclosure;
  }

  @Post('disclosure-counts')
  @HttpCode(HttpStatus.OK)
  @AuditedRead({ action: 'clarification.disclosure-counted', resource: 'clarification' })
  @ApiHeader({
    name: 'X-Acting-Subject',
    required: true,
    description:
      'The access officer (or supervisor) weighing the scope before the decision; recorded in the audit event as the actor and the recipient of the counts',
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiBody({ schema: z.toJSONSchema(clarificationCountsRequest) as object })
  @ApiOperation({
    operationId: 'internalCountClarificationDisclosure',
    summary: 'How many clarifications a scope would disclose (audited, no content)',
  })
  @ApiOkResponse({ description: 'Per declaration named, the clarifications in the scope' })
  @ApiProblemResponse(
    400,
    'Body failed validation, a legal basis that does not go with the request reference, or no X-Acting-Subject',
  )
  async count(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @ActingSubject(new ZodValidationPipe(z.string().min(1).max(255))) actingSubject: string,
    @Body(new ZodValidationPipe(clarificationCountsRequest)) request: ClarificationCountsRequest,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<ClarificationCounts> {
    const { counts, clarificationIds } = await this.clarifications.count(
      { tenant, subject: principal.subject },
      request,
    );
    // The clarifications counted, by id: investigators can tell whose were weighed.
    audit.resource({ tenant, subjectPersonId: request.personId, ids: clarificationIds });
    audit.disclosure({
      basis: request.legalBasis,
      reference: request.grantReference,
      recipient: actingSubject,
    });
    return counts;
  }
}
