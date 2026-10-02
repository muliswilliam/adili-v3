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
  schemaRef,
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
  @ApiBody({ required: true, schema: schemaRef('ClarificationDisclosureRequest') })
  @ApiOperation({
    operationId: 'internalDiscloseClarifications',
    summary: 'The clarifications an access grant discloses with the declarations (audited)',
    description:
      "Service tokens with scope review:disclosures (the access service only), acting for the Commission in X-Acting-Tenant. A Form K grant that includes clarifications (Act s.36(1), Regulation 22(1)) discloses those issued on the declarations it disclosed: every clarification issued on each named declaration of the person at the Commission (never a draft or a withdrawn one), oldest issued first, each item as its letter put it with the declarant's answer (text and the names of the files attached; not the files), cut to the granted household members and sections. An item goes out only when everything it can concern is granted: a spouse's or child's needs them included; `bio` needs bio, `household` bio with spouses and children, `other` other information, a financial statement's income, assets and liabilities, the declaration as a whole every section and both household members. A clarification with no item in the scope is left out; the reviewer's resolution note never goes out. Audited (`audit.read.v1`, action `clarification.disclosed`) with the legal basis, the grant reference, the recipient and the clarifications served. A read: no Idempotency-Key, safe to retry.",
  })
  @ApiOkResponse({
    description: 'The clarifications in the granted scope, oldest issued first',
    schema: schemaRef('ClarificationDisclosure'),
  })
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
  @ApiBody({ required: true, schema: schemaRef('ClarificationCountsRequest') })
  @ApiOperation({
    operationId: 'internalCountClarificationDisclosure',
    summary: 'How many clarifications a scope would disclose (audited, no content)',
    description:
      'Service tokens with scope review:disclosures (the access service only), acting for the Commission in X-Acting-Tenant. Before deciding a Form K request, the access officer sees what the scope holds: per declaration named, how many clarifications a grant of the scope would disclose with it, cut as `internalDiscloseClarifications` cuts them (zero for one with none). Counts only, never content. Audited (`audit.read.v1`, action `clarification.disclosure-counted`) with the legal basis, the request reference, the officer as recipient and the clarifications counted. A read: no Idempotency-Key.',
  })
  @ApiOkResponse({
    description: 'Per declaration named, the clarifications in the scope',
    schema: schemaRef('ClarificationCounts'),
  })
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
