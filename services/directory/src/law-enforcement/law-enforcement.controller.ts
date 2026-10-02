import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ActingTenant,
  AuditedRead,
  CurrentReadAudit,
  type ReadAudit,
  CurrentPrincipal,
  InternalApi,
  type Principal,
  RequireIdempotencyKey,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { DIRECTORY_LAW_ENFORCEMENT_SCOPE, LAW_ENFORCEMENT, PLATFORM_ADMIN } from '@adili/roles';
import { z } from 'zod';

import { STAFF_ROLES } from '../commissions/access.js';
import { LawEnforcementOfficersService } from './officers.service.js';
import {
  type Agency,
  type InternalLeaOfficer,
  type LeaOfficerAccount,
  type ProvisionAgencyOfficerBody,
  provisionAgencyOfficerBody,
} from './representation.js';

/** The `code` path parameter, documented as the contract's `AgencyCode`. */
const ApiAgencyCodeParam = () => ApiParam({ name: 'code', schema: schemaRef('AgencyCode') });

/**
 * Law-enforcement agencies and their officers' accounts (spec 10). Agencies are reference data
 * for every console user; officer accounts are the platform admin's.
 */
@ApiTags('law-enforcement')
@Controller('v1/law-enforcement')
export class LawEnforcementController {
  constructor(private readonly officers: LawEnforcementOfficersService) {}

  @Get('agencies')
  @Roles(...STAFF_ROLES, LAW_ENFORCEMENT)
  @ApiOperation({
    operationId: 'listAgencies',
    summary: 'Registered law-enforcement agencies (reference data)',
    description:
      'Any staff role and law-enforcement officers. Seeded reference data in display order.',
  })
  @ApiOkResponse({
    description: 'Agencies',
    schema: { type: 'array', items: schemaRef('Agency') },
  })
  @ApiProblemResponse(403, 'Declarants and applicants have no access')
  listAgencies(@CurrentPrincipal() principal: Principal): Promise<Agency[]> {
    return this.officers.listAgencies(principal);
  }

  @Get('agencies/:code/officers')
  @ApiAgencyCodeParam()
  @Roles(PLATFORM_ADMIN)
  @ApiOperation({
    operationId: 'listAgencyOfficers',
    summary: 'Provisioned officer accounts for an agency (platform-admin)',
    description: 'platform-admin only. Every officer ever provisioned for the agency, by name.',
  })
  @ApiOkResponse({
    description: 'Officers',
    schema: { type: 'array', items: schemaRef('LeaOfficerAccount') },
  })
  @ApiProblemResponse(403, 'Only platform admins manage officer accounts')
  @ApiProblemResponse(404, 'No agency has this code')
  listOfficers(
    @CurrentPrincipal() principal: Principal,
    @Param('code') code: string,
  ): Promise<LeaOfficerAccount[]> {
    return this.officers.listOfficers(principal, code);
  }

  @Post('agencies/:code/officers')
  @ApiAgencyCodeParam()
  @Roles(PLATFORM_ADMIN)
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'provisionAgencyOfficer',
    summary: 'Provision a law-enforcement officer account (platform-admin); one activation email',
    description:
      "platform-admin only. Creates the officer's directory person (kind `law-enforcement`) and Keycloak account: the email as username, role `law-enforcement`, tenant `lea`, the `agency` and `person_id` attributes, and the staff required actions (verify email, set a password, enrol TOTP); then, once recorded, sends exactly one activation email. Provisioning an officer of this agency again updates their name and phone (and resends the email while they are `invited`); a revoked officer is enabled and invited again. Idempotent per Idempotency-Key.",
  })
  @ApiBody({ required: true, schema: schemaRef('ProvisionAgencyOfficer') })
  @ApiCreatedResponse({
    description: 'The officer account, `invited` when new or provisioned again',
    schema: schemaRef('LeaOfficerAccount'),
  })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, 'Only platform admins manage officer accounts')
  @ApiProblemResponse(404, 'No agency has this code')
  @ApiProblemResponse(
    409,
    'Problem type `email-belongs-to-other-tenant` with `errors[0].path = email`: the email belongs to an account that is not a law-enforcement officer. Problem type `lea-officer-of-other-agency`: it belongs to an officer of another agency. Problem type `lea-officer-busy`: another change to this officer is still in progress; try again shortly. Nothing changed.',
  )
  @ApiProblemResponse(
    502,
    'Problem type `identity-unavailable`: the identity provider failed and nothing was provisioned. Problem type `invitation-not-sent`: the officer was provisioned but the activation email was not sent; provision them again to resend it. Both are safe to retry.',
  )
  provision(
    @CurrentPrincipal() principal: Principal,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(provisionAgencyOfficerBody)) body: ProvisionAgencyOfficerBody,
  ): Promise<LeaOfficerAccount> {
    return this.officers.provision(principal, code, body);
  }

  @Post('officers/:officerId/revoke')
  @ApiParam({ name: 'officerId', schema: { type: 'string', format: 'uuid' } })
  @Roles(PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'revokeAgencyOfficer',
    summary: 'Disable a law-enforcement officer account (platform-admin)',
    description:
      'platform-admin only. Disables the Keycloak account, so the officer signs in no more, and records the officer as `revoked`. Revoking a revoked officer changes nothing, so no Idempotency-Key is needed.',
  })
  @ApiOkResponse({ description: 'Revoked', schema: schemaRef('LeaOfficerAccount') })
  @ApiProblemResponse(400, 'officerId is not a UUID')
  @ApiProblemResponse(403, 'Only platform admins manage officer accounts')
  @ApiProblemResponse(404, 'No officer has this id')
  @ApiProblemResponse(
    409,
    'Problem type `lea-officer-busy`: another change to this officer is still in progress; try again shortly.',
  )
  @ApiProblemResponse(
    502,
    'Problem type `identity-unavailable`: the identity provider failed and the officer was not revoked. Safe to retry.',
  )
  revoke(
    @CurrentPrincipal() principal: Principal,
    @Param('officerId', new ZodValidationPipe(z.uuid())) officerId: string,
  ): Promise<LeaOfficerAccount> {
    return this.officers.revoke(principal, officerId);
  }
}

/**
 * Internal: not routed by the public entrypoint. The access service checks the provenance of a
 * law enforcement request against the officer's account (r.23(1)), acting for the Commission the
 * request is addressed to (X-Acting-Tenant, for the audit trail): officers belong to no
 * Commission, so any acting tenant reads them. Officers' names and accounts are personal data:
 * only the access service's token carries `directory:law-enforcement`.
 */
@ApiTags('internal')
@Controller('internal/v1/law-enforcement/officers')
@InternalApi(DIRECTORY_LAW_ENFORCEMENT_SCOPE)
export class InternalLawEnforcementController {
  constructor(private readonly officers: LawEnforcementOfficersService) {}

  @Get(':personId')
  @AuditedRead({ action: 'lea-officer.read', resource: 'person' })
  @ApiParam({ name: 'personId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetLeaOfficer',
    summary: "A law-enforcement officer's account and agency (access)",
    description:
      "Service tokens with scope directory:law-enforcement (the access service only), acting for any tenant; audited. The officer's agency, the Keycloak account their tokens are issued to, and its state: the access service records a request's provenance from it and refuses requests from accounts that are not, or no longer, active.",
  })
  @ApiOkResponse({ description: 'The officer', schema: schemaRef('InternalLeaOfficer') })
  @ApiProblemResponse(400, 'personId is not a UUID')
  @ApiProblemResponse(404, 'No law-enforcement officer has this id')
  async find(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('personId', new ZodValidationPipe(z.uuid())) personId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<InternalLeaOfficer> {
    const officer = await this.officers.internalOfficer(principal.subject, personId);
    audit.resource({ tenant, subjectPersonId: officer.personId });
    return officer;
  }
}
