import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { type IntakeQuery, ReferralsService } from './referrals.service.js';
import type { ReferralIntakeItem, ReferralIntakePage } from './representation.js';
import { ICMS_STATUSES } from './schema.js';

const intakeQuery = z.object({
  icmsStatus: z.enum(ICMS_STATUSES).optional(),
  cursor: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .meta({ description: "The previous page's `nextCursor`" }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const EACC_ONLY = 'Only EACC analysts and supervisors';

/**
 * EACC's referrals intake (spec 09): the referrals Commissions sent, with their evidence package
 * and ICMS status, and the push to ICMS that stores the case number (EACC analysts and
 * supervisors; everyone else 403).
 */
@ApiTags('referrals-intake')
@Controller('v1/eacc/referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @ApiOperation({
    operationId: 'listReferralIntake',
    summary: 'Referrals sent by Commissions with ICMS status (EACC roles)',
    description:
      "EACC's intake of the referrals Commissions sent (`referral.sent.v1`), the latest sent first, with the Confidential evidence package's document id (downloaded from the documents service) and where the hand-off to ICMS stands. EACC analysts and supervisors only.",
  })
  @ApiQueryParameters(intakeQuery)
  @ApiOkResponse({ description: 'Page', schema: schemaRef('ReferralIntakePage') })
  @ApiProblemResponse(400, 'Query failed validation, or a cursor this list did not give')
  @ApiProblemResponse(403, EACC_ONLY)
  list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(intakeQuery)) query: z.infer<typeof intakeQuery>,
  ): Promise<ReferralIntakePage> {
    const filters: IntakeQuery = { limit: query.limit };
    if (query.icmsStatus !== undefined) filters.icmsStatus = query.icmsStatus;
    if (query.cursor !== undefined) filters.cursor = query.cursor;
    return this.referrals.list(principal, filters);
  }

  @Post(':referralId/push')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ApiParam({ name: 'referralId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'pushReferralToIcms',
    summary: 'Push a referral to ICMS and store the case number (analyst)',
    description:
      "EACC analysts and supervisors. Pulls the referral's ICMS payload from review (national ID, full name, grounds, details) and registers it through the integration-gateway's ICMS adapter (`submitIcmsReferral`), idempotent by the `RFL` reference; ICMS is retried with backoff while unreachable. A case number is stored (`registered`) and `referral.icms-registered.v1` published; a registration ICMS only accepted is `pushed` and followed to its case number. A retry with the same Idempotency-Key replays the answer; a registered referral is answered as it is and never sent again.",
  })
  @ApiOkResponse({
    description: 'Registered (or already registered), or pushed and awaiting the case number',
    schema: schemaRef('ReferralIntakeItem'),
  })
  @ApiProblemResponse(400, 'Idempotency-Key missing, or referralId is not a UUID')
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(404, 'Not in the intake')
  @ApiProblemResponse(
    502,
    'Problem code `icms-push-failed` with `error` (an `IcmsPushError`): the referral is left push-failed; push it again to retry',
  )
  @ApiProblemResponse(
    503,
    'ICMS accepted the referral but the workflow following its case number could not be started; push it again shortly',
  )
  push(
    @CurrentPrincipal() principal: Principal,
    @Param('referralId', new ZodValidationPipe(z.uuid())) referralId: string,
  ): Promise<ReferralIntakeItem> {
    return this.referrals.push(principal, referralId);
  }
}
