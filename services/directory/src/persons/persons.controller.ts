import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  Roles,
  Scopes,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { z } from 'zod';

import { DECLARANT_ROLE } from '../identity/identity-provisioning.js';
import { DIRECTORY_INTERNAL_SCOPE } from '../internal-api.js';
import { PersonsService } from './persons.service.js';
import {
  type DeclarantProfile,
  type FindPersonQuery,
  findPersonQuery,
  type PersonContacts,
  type PersonSummary,
} from './representation.js';

/** Roles that look a person up by officer reference (spec 03 authorisation matrix). */
export const PERSON_LOOKUP_ROLES = ['platform-admin', 'helpdesk'] as const;

@ApiTags('persons')
@Controller('v1/persons')
export class PersonsController {
  constructor(private readonly persons: PersonsService) {}

  @Get()
  @Roles(...PERSON_LOOKUP_ROLES)
  @AuditedRead({ action: 'person.looked-up', resource: 'person' })
  @ApiOperation({
    operationId: 'findPersonByOfr',
    summary: 'Look up account metadata by officer reference',
    description:
      'Helpdesk and platform admins, audited. Account metadata only: who the person is and which Commissions they are onboarded at, never the contents of their roster records. The officer reference is validated with its check character, so a mistyped one is 400 rather than 404.',
  })
  @ApiQueryParameters(findPersonQuery)
  @ApiOkResponse({
    description: 'Account metadata without roster contents',
    schema: schemaRef('PersonSummary'),
  })
  @ApiProblemResponse(400, 'Not an officer reference: wrong shape or check character')
  @ApiProblemResponse(403, 'Only the helpdesk and platform admins look persons up')
  @ApiProblemResponse(404, 'No person has this officer reference')
  find(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(findPersonQuery)) query: FindPersonQuery,
  ): Promise<PersonSummary> {
    return this.persons.findByOfr(principal.subject, query.ofr);
  }
}

@ApiTags('me')
@Controller('v1/me')
export class DeclarantProfileController {
  constructor(private readonly persons: PersonsService) {}

  @Get('declarant')
  @Roles(DECLARANT_ROLE)
  @ApiOperation({
    operationId: 'getMyDeclarantProfile',
    summary: "The signed-in declarant's person, OFR, Commissions and verified contacts",
    description:
      'Declarants only, their own: the person is the one whose account is the token\'s subject. The portal dashboard reads it, and takes 403 and 404 alike as "not a declarant".',
  })
  @ApiOkResponse({ description: 'Profile', schema: schemaRef('DeclarantProfile') })
  @ApiProblemResponse(401, 'Missing, expired or invalid access token')
  @ApiProblemResponse(404, 'The account has the declarant role but no onboarded person')
  profile(@CurrentPrincipal() principal: Principal): Promise<DeclarantProfile> {
    return this.persons.declarantProfile(principal.subject);
  }
}

/**
 * Internal: not routed by the public entrypoint. Persons are global (ADR-006), so no acting
 * tenant: services with `directory:internal` only.
 */
@ApiTags('internal')
@Controller('internal/v1/persons')
@Scopes(DIRECTORY_INTERNAL_SCOPE)
export class InternalPersonsController {
  constructor(private readonly persons: PersonsService) {}

  @Get(':personId/contacts')
  @AuditedRead({ action: 'person.contacts.read', resource: 'person' })
  @ApiParam({ name: 'personId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetPersonContacts',
    summary: 'Verified contacts of a person (notifications)',
    description:
      'Service tokens with scope directory:internal; audited. The email and phone verified at the latest onboarding, null where none.',
  })
  @ApiOkResponse({
    description: 'Contacts, null where none is verified',
    schema: schemaRef('PersonContacts'),
  })
  @ApiProblemResponse(400, 'personId is not a UUID')
  @ApiProblemResponse(404, 'No person has this id')
  contacts(
    @Param('personId', new ZodValidationPipe(z.uuid())) personId: string,
  ): Promise<PersonContacts> {
    return this.persons.contacts(personId);
  }
}
