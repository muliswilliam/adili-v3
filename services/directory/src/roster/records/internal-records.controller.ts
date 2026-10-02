import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  IdempotencyKey,
  InternalApi,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { DIRECTORY_ROSTER_NATIONAL_ID_SCOPE } from '@adili/roles';
import { z } from 'zod';

import { DirectoryInternalApi } from '../../internal-api.js';
import {
  type InternalListRosterRecordsQuery,
  internalListRosterRecordsQuery,
} from './internal-query.js';
import { InternalRosterRecordsService } from './internal-records.service.js';
import { OnboardingInvitationsService } from './onboarding-invitations.service.js';
import type {
  InternalRosterRecord,
  OnboardingInvitation,
  InternalRosterRecordPage,
  RosterNationalId,
} from './representation.js';

const CALLERS =
  'Service tokens with scope directory:internal, acting for the Commission in X-Acting-Tenant; audited.';

/**
 * Internal: not routed by the public entrypoint. Callers are services pulling after an event, or
 * searching the roster for a record (the access service, spec 10).
 */
@ApiTags('internal')
@Controller('internal/v1/commissions/:slug/roster/records')
@ApiParam({ name: 'slug', schema: schemaRef('Slug') })
@DirectoryInternalApi()
export class InternalRosterRecordsController {
  constructor(
    private readonly records: InternalRosterRecordsService,
    private readonly invitations: OnboardingInvitationsService,
  ) {}

  @Get()
  @AuditedRead({ action: 'roster.records.pulled', resource: 'roster-record' })
  @ApiOperation({
    operationId: 'internalListRosterRecords',
    summary:
      'Roster records touched by an import or an exit batch, or matching a search (services)',
    description: `${CALLERS} Exactly one of importId, exitBatchId and search. Each record as it is now, up to 1,000 per page (50 for a search).`,
  })
  @ApiQueryParameters(internalListRosterRecordsQuery)
  @ApiOkResponse({
    description: 'Page of records',
    schema: schemaRef('InternalRosterRecordPage'),
  })
  @ApiProblemResponse(
    400,
    'Query failed validation: not exactly one of importId, exitBatchId and search, or an unknown cursor',
  )
  @ApiProblemResponse(404, "No such import or exit batch of the acting tenant's Commission")
  list(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(internalListRosterRecordsQuery))
    query: InternalListRosterRecordsQuery,
  ): Promise<InternalRosterRecordPage> {
    return this.records.list(principal, tenant, slug, query);
  }

  @Get(':recordId')
  @AuditedRead({ action: 'roster.record.pulled', resource: 'roster-record' })
  @ApiParam({ name: 'recordId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetRosterRecord',
    summary: 'One roster record (services)',
    description: `${CALLERS} E.g. after \`declarant.onboarded.v1\`.`,
  })
  @ApiOkResponse({ description: 'The record', schema: schemaRef('InternalRosterRecord') })
  @ApiProblemResponse(400, 'recordId is not a UUID')
  @ApiProblemResponse(404, "No such record in the acting tenant's Commission")
  get(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('slug') slug: string,
    @Param('recordId', new ZodValidationPipe(z.uuid())) recordId: string,
  ): Promise<InternalRosterRecord> {
    return this.records.get(principal, tenant, slug, recordId);
  }

  @Post(':recordId/onboarding-invitations')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ApiParam({ name: 'recordId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalInviteRosterRecord',
    summary: "Invite a roster record's officer to set up their declarant account (services)",
    description: `${CALLERS} By email and SMS to the contacts the roster holds (whichever it has), templates \`onboarding-invitation-email\` and \`onboarding-invitation-sms\`, linking the portal's onboarding for the Commission; the contacts are never returned. The access service calls it when a request names an officer who has not onboarded (spec 10). Once per Idempotency-Key.`,
  })
  @ApiOkResponse({ description: 'Invitation', schema: schemaRef('OnboardingInvitation') })
  @ApiProblemResponse(400, 'recordId is not a UUID, or no Idempotency-Key')
  @ApiProblemResponse(404, "No such record in the acting tenant's Commission")
  @ApiProblemResponse(409, 'Problem code `already-onboarded`: the officer has an account')
  @ApiProblemResponse(503, 'The notifications service cannot be reached; nothing was recorded')
  invite(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('slug') slug: string,
    @Param('recordId', new ZodValidationPipe(z.uuid())) recordId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<OnboardingInvitation> {
    return this.invitations.invite(principal, tenant, slug, recordId, idempotencyKey);
  }
}

/**
 * Internal: not routed by the public entrypoint. A national ID is personal data: only the review
 * service's token carries `directory:roster-national-id`, for payroll's salary stoppage and the
 * ICMS referral (spec 08), acting for the Commission in X-Acting-Tenant (ADR-013 §8.1).
 */
@ApiTags('internal')
@Controller('internal/v1/commissions/:slug/roster/records/:recordId/national-id')
@ApiParam({ name: 'slug', schema: schemaRef('Slug') })
@ApiParam({ name: 'recordId', schema: { type: 'string', format: 'uuid' } })
@InternalApi(DIRECTORY_ROSTER_NATIONAL_ID_SCOPE)
export class InternalRosterNationalIdController {
  constructor(private readonly records: InternalRosterRecordsService) {}

  @Get()
  @AuditedRead({ action: 'roster.record.national-id.read', resource: 'roster-record' })
  @ApiOperation({
    operationId: 'internalGetRosterNationalId',
    summary: "A roster record's national ID (review)",
    description:
      'Service tokens with scope directory:roster-national-id (the review service only), acting for the Commission in X-Acting-Tenant; audited. What payroll and the ICMS referral identify the officer by.',
  })
  @ApiOkResponse({ description: 'The national ID', schema: schemaRef('RosterNationalId') })
  @ApiProblemResponse(400, 'recordId is not a UUID')
  @ApiProblemResponse(404, "No such record in the acting tenant's Commission")
  get(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('slug') slug: string,
    @Param('recordId', new ZodValidationPipe(z.uuid())) recordId: string,
  ): Promise<RosterNationalId> {
    return this.records.nationalId(principal, tenant, slug, recordId);
  }
}
