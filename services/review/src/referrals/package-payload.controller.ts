import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  InternalApi,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { REVIEW_INTERNAL_SCOPE } from '@adili/roles';
import { z } from 'zod';

import {
  type ReferralPackagePayload,
  ReferralPackagePayloadService,
} from './package-payload.service.js';

/**
 * Internal: not routed by the public entrypoint. The documents service pulls a referral package's
 * cover sheet, manifest and evidence here when it renders the Confidential package, so none of it
 * travels in the issue request, in events or in workflow history (spec 08, ADR-010).
 */
@ApiTags('internal')
@Controller('internal/v1/review/referrals')
export class ReferralPackagePayloadController {
  constructor(private readonly packages: ReferralPackagePayloadService) {}

  @Get(':referralId/package-payload')
  @InternalApi(REVIEW_INTERNAL_SCOPE)
  @ApiParam({ name: 'referralId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetReferralPackagePayload',
    summary: 'Cover sheet, manifest and evidence the referral package template needs (documents)',
  })
  @ApiOkResponse({ description: 'Payload', schema: schemaRef('ReferralPackagePayload') })
  @ApiProblemResponse(
    404,
    'No approved referral with a manifest with this id at the acting Commission',
  )
  @ApiProblemResponse(502, 'The evidence could not be read from declarations or documents')
  @ApiProblemResponse(503, 'The Commission directory could not be reached')
  payload(
    @ActingTenant() tenant: string,
    @Param('referralId', new ZodValidationPipe(z.uuid())) referralId: string,
  ): Promise<ReferralPackagePayload> {
    return this.packages.payload(tenant, referralId);
  }
}
