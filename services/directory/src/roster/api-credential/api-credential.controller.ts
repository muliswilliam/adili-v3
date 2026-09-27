import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  Roles,
  schemaRef,
} from '@adili/api-kit';

import { REPORTING_OFFICER_ROLE } from '../../commissions/access.js';
import { ApiCredentialService } from './api-credential.service.js';
import type { RosterApiCredential, RosterApiCredentialWithSecret } from './representation.js';

const NOT_VISIBLE = "Not found: another Commission's credential, or the Commission does not exist";
const IDENTITY_UNAVAILABLE =
  'Problem type `identity-unavailable`: the identity provider failed and nothing changed. Safe to retry.';

/**
 * The Commission's HR-system credential (spec #27): reporting officer of the Commission only.
 * No Idempotency-Key: a stored response would store the secret.
 */
@ApiTags('roster')
@Controller('v1/commissions/:slug/roster/api-credential')
@ApiParam({ name: 'slug', schema: schemaRef('Slug') })
@Roles(REPORTING_OFFICER_ROLE)
export class ApiCredentialController {
  constructor(private readonly credentials: ApiCredentialService) {}

  @Get()
  @ApiOperation({
    operationId: 'getRosterApiCredential',
    summary: "Metadata of the Commission's HR-system credential (never the secret)",
    description: 'Reporting officer of the Commission. Revoked credentials are returned too.',
  })
  @ApiOkResponse({
    description: 'Metadata, or null when none was created',
    schema: { oneOf: [schemaRef('RosterApiCredential'), { type: 'null' }] },
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<RosterApiCredential | null> {
    return this.credentials.get(principal, slug);
  }

  @Post()
  @ApiOperation({
    operationId: 'createRosterApiCredential',
    summary: 'Create the credential; the secret is returned once',
    description:
      'Reporting officer of the Commission. Creates an API client whose tokens (client credentials grant) carry the `roster:write` scope and the Commission as `tenant`. Allowed when there is no credential or it was revoked; a new credential gets a new client id.',
  })
  @ApiCreatedResponse({
    description: 'Credential with secret',
    schema: schemaRef('RosterApiCredentialWithSecret'),
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem type `api-credential-exists`: a credential exists; rotate or revoke it',
  )
  @ApiProblemResponse(502, IDENTITY_UNAVAILABLE)
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<RosterApiCredentialWithSecret> {
    return this.credentials.create(principal, slug);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'revokeRosterApiCredential',
    summary: 'Revoke the credential; the HR system loses access immediately',
    description:
      'Reporting officer of the Commission. The client obtains no more tokens; tokens already issued expire within their lifespan (minutes).',
  })
  @ApiNoContentResponse({ description: 'Revoked' })
  @ApiProblemResponse(404, `${NOT_VISIBLE}, or there is no credential that is not revoked`)
  @ApiProblemResponse(502, IDENTITY_UNAVAILABLE)
  revoke(@CurrentPrincipal() principal: Principal, @Param('slug') slug: string): Promise<void> {
    return this.credentials.revoke(principal, slug);
  }

  @Post('rotate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'rotateRosterApiCredential',
    summary: 'Issue a new secret; the previous one stops working immediately',
    description: 'Reporting officer of the Commission. The client id stays the same.',
  })
  @ApiOkResponse({
    description: 'Credential with the new secret',
    schema: schemaRef('RosterApiCredentialWithSecret'),
  })
  @ApiProblemResponse(404, `${NOT_VISIBLE}, or there is no credential that is not revoked`)
  @ApiProblemResponse(
    409,
    "Problem type `api-credential-client-missing`: the credential's client no longer exists in the identity provider; revoke and create new credentials",
  )
  @ApiProblemResponse(502, IDENTITY_UNAVAILABLE)
  rotate(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<RosterApiCredentialWithSecret> {
    return this.credentials.rotate(principal, slug);
  }
}
