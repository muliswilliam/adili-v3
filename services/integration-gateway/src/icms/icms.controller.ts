import { Body, Controller, Get, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  notFoundIfInvisible,
  type Principal,
  schemaRef,
  Scopes,
  ZodValidationPipe,
} from '@adili/api-kit';
import { ICMS_SCOPE } from '@adili/roles';
import type { FastifyReply } from 'fastify';

import {
  CurrentInstructionPurpose,
  type InstructionPurpose,
  InstructionPurposeHeaders,
} from '../adapter-kit/lookup-purpose.js';
import { ICMS_LEGAL_BASES } from '../db/schema.js';
import { IcmsReferrals } from './icms-referrals.js';
import {
  type IcmsReferral,
  type IcmsReferralRequest,
  icmsReferralRequestSchema,
  REFERRAL_REFERENCE,
  referralReferenceSchema,
} from './icms-records.js';

const SCOPE = `Requires a service token with scope \`${ICMS_SCOPE}\`. Referrals act for no tenant: the referring Commission is in the referral (ADR-013 section 8.7).`;
const referral = (description: string) => ({
  description,
  content: { 'application/json': { schema: schemaRef('IcmsReferral') } },
});

/**
 * Referrals to EACC's case management system for the reporting service's referrals intake (spec
 * 09): a Commission's referral registered with ICMS, and its case number read back. Internal:
 * services with the `icms` scope.
 */
@ApiTags('internal')
@ApiBearerAuth()
@Scopes(ICMS_SCOPE)
@Controller('internal/v1/icms/referrals')
export class IcmsController {
  constructor(private readonly referrals: IcmsReferrals) {}

  @Post()
  @InstructionPurposeHeaders(ICMS_LEGAL_BASES)
  @ApiOperation({
    operationId: 'submitIcmsReferral',
    summary:
      'Register a referral with ICMS and return the case number (idempotent by referral reference)',
    description: `Registers the referral with ICMS and stores its registration (case number, status, registered at) with the legal basis and case. Idempotent by referral reference: the same referral again answers the stored registration (200) without calling ICMS; one about another declarant or from another Commission under the same reference is 409. Behind ICMS's own circuit breaker, rate limit, timeout and pause; never cached. ICMS not answering is 503 and nothing is recorded as registered: retry. The national ID and name travel in the body; only the national ID is kept, as a keyed hash. ${SCOPE}`,
  })
  @ApiBody({ required: true, schema: schemaRef('IcmsReferralRequest') })
  @ApiResponse({ status: HttpStatus.CREATED, ...referral('Registered now') })
  @ApiResponse({ status: HttpStatus.OK, ...referral('Already registered (replay)') })
  @ApiProblemResponse(
    HttpStatus.CONFLICT,
    'Problem type `referral-reference-conflict`: another referral was registered under the reference',
  )
  @ApiProblemResponse(
    HttpStatus.SERVICE_UNAVAILABLE,
    'Problem type `upstream-unavailable`: ICMS did not answer (down, timed out, breaker open or paused); nothing registered',
  )
  async submit(
    @Body(new ZodValidationPipe(icmsReferralRequestSchema)) body: IcmsReferralRequest,
    @CurrentInstructionPurpose() purpose: InstructionPurpose,
    @CurrentPrincipal() caller: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<IcmsReferral> {
    const { referral, replayed } = await this.referrals.submit(body, purpose, caller);
    void reply.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return referral;
  }

  @Get(':referralReference')
  @ApiOperation({
    operationId: 'getIcmsReferral',
    summary: 'Stored ICMS registration for a referral reference',
    description: `The referral as ICMS registered it, from the gateway's store (ICMS is not called). ${SCOPE}`,
  })
  @ApiParam({
    name: 'referralReference',
    schema: { type: 'string', pattern: REFERRAL_REFERENCE.source },
  })
  @ApiResponse({ status: HttpStatus.OK, ...referral('The registration') })
  @ApiProblemResponse(HttpStatus.NOT_FOUND, 'No referral registered under the reference')
  async read(
    @Param('referralReference', new ZodValidationPipe(referralReferenceSchema))
    referralReference: string,
  ): Promise<IcmsReferral> {
    return notFoundIfInvisible(await this.referrals.read(referralReference));
  }
}
