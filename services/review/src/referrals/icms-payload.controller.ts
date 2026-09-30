import { Controller, Get, Param } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, AuditedRead, schemaRef, ZodValidationPipe } from '@adili/api-kit';
import { z } from 'zod';

import { ActingTenant, InternalRoute } from '../internal-api/acting-tenant.js';
import { type ReferralIcmsPayload, ReferralIcmsPayloadService } from './icms-payload.service.js';

/**
 * Internal: not routed by the public entrypoint. The reporting service pulls what ICMS needs of a
 * sent referral here when an EACC analyst pushes it (spec 09 BE-5, BE-11), so the declarant's
 * name and national ID travel in neither its database, its events nor its workflow history. Every
 * read is audited (ADR-008), with the analyst the service acts for when it names one.
 */
@ApiTags('internal')
@Controller('internal/v1/review/referrals')
export class ReferralIcmsPayloadController {
  constructor(private readonly payloads: ReferralIcmsPayloadService) {}

  @Get(':referralId/icms-payload')
  @InternalRoute()
  @AuditedRead({ action: 'review.referral.icms-payload.read', resource: 'referral' })
  @ApiParam({ name: 'referralId', schema: { type: 'string', format: 'uuid' } })
  @ApiHeader({
    name: 'X-Acting-Subject',
    required: false,
    description: 'The officer on whose behalf the service reads it; recorded in the audit event',
    schema: { type: 'string' },
  })
  @ApiOperation({
    operationId: 'internalGetReferralIcmsPayload',
    summary: "What ICMS needs of a sent referral, with the declarant's national ID (reporting)",
  })
  @ApiOkResponse({ description: 'Payload', schema: schemaRef('ReferralIcmsPayload') })
  @ApiProblemResponse(404, 'No sent referral with this id at the acting Commission')
  @ApiProblemResponse(
    409,
    'Problem code `roster-record-unknown`: no roster record of the declarant is known, so the national ID cannot be read',
  )
  @ApiProblemResponse(503, 'The Commission directory could not be reached')
  payload(
    @ActingTenant() tenant: string,
    @Param('referralId', new ZodValidationPipe(z.uuid())) referralId: string,
  ): Promise<ReferralIcmsPayload> {
    return this.payloads.payload(tenant, referralId);
  }
}
