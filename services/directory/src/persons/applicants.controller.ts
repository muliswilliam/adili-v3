import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
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
import { APPLICANT, DIRECTORY_APPLICANTS_SCOPE } from '@adili/roles';
import { z } from 'zod';

import { ApplicantsService } from './applicants.service.js';
import {
  type ApplicantProfile,
  type InternalApplicant,
  type VerifyApplicantIdentityBody,
  verifyApplicantIdentityBody,
} from './representation.js';

@ApiTags('me')
@Controller('v1/me')
export class ApplicantProfileController {
  constructor(private readonly applicants: ApplicantsService) {}

  @Get('applicant')
  @Roles(APPLICANT)
  @ApiOperation({
    operationId: 'getMyApplicantProfile',
    summary: "The signed-in applicant's particulars and identity status",
    description:
      "Applicants only, their own: the person is the one whose account is the token's subject. The portal pre-fills Part I of Form K from it.",
  })
  @ApiOkResponse({ description: 'Profile', schema: schemaRef('ApplicantProfile') })
  @ApiProblemResponse(401, 'Missing, expired or invalid access token')
  @ApiProblemResponse(403, 'Not an applicant')
  @ApiProblemResponse(404, 'The account has the applicant role but no applicant person')
  profile(@CurrentPrincipal() principal: Principal): Promise<ApplicantProfile> {
    return this.applicants.profile(principal.subject);
  }
}

/**
 * Internal: not routed by the public entrypoint. Applicants' particulars are personal data: only
 * the access service's token carries `directory:applicants` (spec 10). Applicants belong to no
 * tenant; X-Acting-Tenant names the Commission the access service acts for, for the audit trail.
 */
@ApiTags('internal')
@Controller('internal/v1/applicants/:personId')
@InternalApi(DIRECTORY_APPLICANTS_SCOPE)
export class InternalApplicantsController {
  constructor(private readonly applicants: ApplicantsService) {}

  @Get()
  @AuditedRead({ action: 'applicant.read', resource: 'person' })
  @ApiParam({ name: 'personId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetApplicant',
    summary: "An applicant's particulars and identity status (access)",
    description:
      'Service tokens with scope directory:applicants (the access service only); audited. The identity document, names and contacts entered at applicant onboarding, and whether the identity is verified: Form K of a `pending-verification` applicant is held until an access officer verifies it.',
  })
  @ApiOkResponse({ description: 'The applicant', schema: schemaRef('InternalApplicant') })
  @ApiProblemResponse(400, 'personId is not a UUID')
  @ApiProblemResponse(404, 'No applicant has this id')
  async find(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('personId', new ZodValidationPipe(z.uuid())) personId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<InternalApplicant> {
    const applicant = await this.applicants.find(principal.subject, personId);
    audit.resource({ tenant, subjectPersonId: applicant.personId });
    return applicant;
  }

  @Post('identity-verification')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ApiParam({ name: 'personId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalVerifyApplicantIdentity',
    summary: "Record an access officer's verification of an applicant's identity (access)",
    description:
      "Service tokens with scope directory:applicants (the access service only), acting for the officer's Commission. The applicant's identity status becomes `verified`, on the person and on the account (`identityStatus` attribute), and `applicant.identity-verified.v1` is recorded. Idempotent: an applicant already verified (by IPRS, or before) is returned unchanged.",
  })
  @ApiBody({ schema: schemaRef('VerifyApplicantIdentity') })
  @ApiOkResponse({ description: 'The applicant, verified', schema: schemaRef('InternalApplicant') })
  @ApiProblemResponse(400, 'personId is not a UUID, or the body failed validation')
  @ApiProblemResponse(404, 'No applicant has this id')
  @ApiProblemResponse(
    502,
    'Problem code `identity-unavailable`: the account could not be changed; nothing changed, try again',
  )
  verify(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('personId', new ZodValidationPipe(z.uuid())) personId: string,
    @Body(new ZodValidationPipe(verifyApplicantIdentityBody)) body: VerifyApplicantIdentityBody,
  ): Promise<InternalApplicant> {
    return this.applicants.verifyIdentity(
      { tenant, subject: principal.subject },
      personId,
      body.verifiedBy,
    );
  }
}
