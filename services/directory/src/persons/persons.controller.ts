import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentReadAudit,
  type ReadAudit,
  CurrentPrincipal,
  type Principal,
  InternalApi,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import {
  DECLARANT,
  DIRECTORY_INTERNAL_SCOPE,
  DIRECTORY_PERSON_CONTACTS_SCOPE,
  DIRECTORY_PERSON_NATIONAL_ID_SCOPE,
  HELPDESK,
  PLATFORM_ADMIN,
} from '@adili/roles';

import { z } from 'zod';

import { PersonsService } from './persons.service.js';
import {
  type DeclarantProfile,
  type FindPersonQuery,
  findPersonQuery,
  type PersonContacts,
  type PersonNationalId,
  type PersonPreferredLanguage,
  type PersonSummary,
  type SetPreferredLanguageBody,
  setPreferredLanguageBody,
} from './representation.js';

/** Roles that look a person up by officer reference (spec 03 authorisation matrix). */
export const PERSON_LOOKUP_ROLES = [PLATFORM_ADMIN, HELPDESK] as const;

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
  @Roles(DECLARANT)
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

  @Put('declarant/preferred-language')
  @Roles(DECLARANT)
  @ApiOperation({
    operationId: 'setMyPreferredLanguage',
    summary: "Set the signed-in declarant's preferred language",
    description:
      "Declarants only, their own. English or Kiswahili: a clarification letter to them starts in it, and so does the reviewer's Draft with AI (spec 07c FE-3). Setting the same language again changes nothing.",
  })
  @ApiBody({ required: true, schema: schemaRef('SetPreferredLanguage') })
  @ApiOkResponse({
    description: 'Profile with the language stored',
    schema: schemaRef('DeclarantProfile'),
  })
  @ApiProblemResponse(400, 'Not a language letters are issued in')
  @ApiProblemResponse(401, 'Missing, expired or invalid access token')
  @ApiProblemResponse(404, 'The account has the declarant role but no onboarded person')
  setPreferredLanguage(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(setPreferredLanguageBody)) body: SetPreferredLanguageBody,
  ): Promise<DeclarantProfile> {
    return this.persons.setPreferredLanguage(principal.subject, body.preferredLanguage);
  }
}

/**
 * Internal: not routed by the public entrypoint. A declarant's preferred language, for services
 * with `directory:internal` acting for a Commission they are onboarded at: the review service
 * starts a clarification letter in it (spec 07c FE-3). Not personal data, so not audited.
 */
@ApiTags('internal')
@Controller('internal/v1/persons')
@InternalApi(DIRECTORY_INTERNAL_SCOPE)
export class InternalPersonPreferencesController {
  constructor(private readonly persons: PersonsService) {}

  @Get(':personId/preferred-language')
  @ApiParam({ name: 'personId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetPersonPreferredLanguage',
    summary: "A declarant's preferred language (review)",
    description:
      'Service tokens with scope directory:internal, acting for a Commission the declarant is onboarded at. The language the declarant chose in the portal, null until they choose one. 404 when the person is unknown or not a declarant onboarded at that tenant.',
  })
  @ApiOkResponse({
    description: 'The preferred language',
    schema: schemaRef('PersonPreferredLanguage'),
  })
  @ApiProblemResponse(400, 'personId is not a UUID')
  @ApiProblemResponse(404, 'No declarant onboarded at the acting tenant has this id')
  preferredLanguage(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('personId', new ZodValidationPipe(z.uuid())) personId: string,
  ): Promise<PersonPreferredLanguage> {
    return this.persons.preferredLanguage({ tenant, subject: principal.subject }, personId);
  }
}

/**
 * Internal: not routed by the public entrypoint. Contacts are personal data: only the
 * notifications service's token carries `directory:person-contacts`, and it names the tenant it
 * sends for in X-Acting-Tenant (ADR-013 §8.1, ADR-017); a declarant not onboarded there is 404.
 * Law-enforcement officers and applicants, who belong to no Commission, are reached for any
 * tenant (spec 10, ADR-013 §8.9).
 */
@ApiTags('internal')
@Controller('internal/v1/persons')
@InternalApi(DIRECTORY_PERSON_CONTACTS_SCOPE)
export class InternalPersonsController {
  constructor(private readonly persons: PersonsService) {}

  @Get(':personId/contacts')
  @AuditedRead({ action: 'person.contacts.read', resource: 'person' })
  @ApiParam({ name: 'personId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetPersonContacts',
    summary: 'Verified contacts of a person (notifications)',
    description:
      "Service tokens with scope directory:person-contacts (the notifications service only), acting for the tenant a message is sent for; audited. A declarant's email and phone verified at the latest onboarding, null where none; a law-enforcement officer's official email and phone as provisioned, and an applicant's as entered at applicant onboarding, whatever the acting tenant (officers and applicants request from any Commission). 404 when the person is unknown, or a declarant not onboarded at that tenant.",
  })
  @ApiOkResponse({
    description: 'Contacts, null where none is verified',
    schema: schemaRef('PersonContacts'),
  })
  @ApiProblemResponse(400, 'personId is not a UUID')
  @ApiProblemResponse(
    404,
    'No person has this id, or a declarant not onboarded at the acting tenant',
  )
  async contacts(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('personId', new ZodValidationPipe(z.uuid())) personId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<PersonContacts> {
    const contacts = await this.persons.contacts({ tenant, subject: principal.subject }, personId);
    audit.resource({ tenant, subjectPersonId: personId });
    return contacts;
  }
}

/**
 * Internal: not routed by the public entrypoint. A national ID is personal data: only the
 * declarations service's token carries `directory:person-national-id`, for the declarant's own
 * registry lookups (spec 05b), acting for the Commission of the declaration (ADR-013 §8.1); a
 * person not onboarded there is 404.
 */
@ApiTags('internal')
@Controller('internal/v1/persons')
@InternalApi(DIRECTORY_PERSON_NATIONAL_ID_SCOPE)
export class InternalPersonNationalIdController {
  constructor(private readonly persons: PersonsService) {}

  @Get(':personId/national-id')
  @AuditedRead({ action: 'person.national-id.read', resource: 'person' })
  @ApiParam({ name: 'personId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetPersonNationalId',
    summary: "A person's national ID (declarations)",
    description:
      "Service tokens with scope directory:person-national-id (the declarations service only), acting for the Commission of the declaration; audited. The national ID verified at onboarding, for the declarant's own registry lookups. 404 when the person is unknown or not onboarded at that tenant.",
  })
  @ApiOkResponse({ description: 'The national ID', schema: schemaRef('PersonNationalId') })
  @ApiProblemResponse(400, 'personId is not a UUID')
  @ApiProblemResponse(404, 'No person has this id, or not one onboarded at the acting tenant')
  nationalId(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('personId', new ZodValidationPipe(z.uuid())) personId: string,
  ): Promise<PersonNationalId> {
    return this.persons.nationalId({ tenant, subject: principal.subject }, personId);
  }
}
