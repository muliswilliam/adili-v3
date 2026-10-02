import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { OFFICER_ROUTE_ROLES } from '../access.js';
import {
  ApplicantVerificationService,
  type VerifyApplicantBody,
  verifyApplicantBody,
} from './applicant-verification.service.js';
import type { OfficerRequestView } from './officer-view.js';

/** The access officer's manual verification of a passport applicant (spec 10). */
@ApiTags('officer')
@Controller('v1/access/requests')
export class ApplicantVerificationController {
  constructor(private readonly verification: ApplicantVerificationService) {}

  @Post(':requestId/verify-applicant')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICER_ROUTE_ROLES)
  @AcceptIdempotencyKey()
  @ApiParam({ name: 'requestId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'verifyApplicantIdentity',
    summary: 'Record manual verification of a passport applicant',
    description:
      "The access officer of the request's Commission checked the particulars a passport applicant entered. Verified: the directory records the applicant's identity as verified, and the request goes from `pending-applicant-verification` to `submitted` (`access.request.verified.v1`). Not verified: the check is recorded and the request stays held.",
  })
  @ApiBody({ required: true, schema: schemaRef('VerifyApplicantIdentity') })
  @ApiOkResponse({ description: 'Recorded', schema: schemaRef('OfficerRequestView') })
  @ApiProblemResponse(400, 'requestId is not a UUID, or the body failed validation')
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(
    404,
    "No such request at the caller's Commission (another Commission's, EACC's or anyone else's view)",
  )
  @ApiProblemResponse(
    409,
    "Problem code `not-pending-verification`: the request is not waiting for the applicant's identity",
  )
  @ApiProblemResponse(503, 'The directory cannot be reached; nothing was recorded')
  verify(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(verifyApplicantBody)) body: VerifyApplicantBody,
  ): Promise<OfficerRequestView> {
    return this.verification.verify(principal, requestId, body);
  }
}
