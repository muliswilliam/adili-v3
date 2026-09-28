import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { PersonsService } from './persons.service.js';
import {
  type DeclarantProfile,
  type FindPersonQuery,
  findPersonQuery,
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
  @ApiOperation({
    operationId: 'getMyDeclarantProfile',
    summary: "The signed-in declarant's person, OFR, Commissions and verified contacts",
    description:
      "Any authenticated caller; the person is the one whose account is the token's subject, so a caller only ever reads their own. The portal dashboard reads it.",
  })
  @ApiOkResponse({ description: 'Profile', schema: schemaRef('DeclarantProfile') })
  @ApiProblemResponse(401, 'Missing, expired or invalid access token')
  @ApiProblemResponse(404, 'The caller is not an onboarded declarant')
  profile(@CurrentPrincipal() principal: Principal): Promise<DeclarantProfile> {
    return this.persons.declarantProfile(principal.subject);
  }
}
