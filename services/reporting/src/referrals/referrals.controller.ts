import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { type IntakeQuery, ReferralsService } from './referrals.service.js';
import type { ReferralIntakeItem, ReferralIntakePage } from './representation.js';
import { ICMS_STATUSES } from './schema.js';

const intakeQuery = z.object({
  icmsStatus: z.enum(ICMS_STATUSES).optional(),
  cursor: z.string().min(1).max(200).optional(),
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
  })
  @ApiQuery({ name: 'icmsStatus', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1 } })
  @ApiOkResponse({ description: 'Page' })
  @ApiProblemResponse(400, 'Query failed validation')
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
  @ApiParam({ name: 'referralId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'pushReferralToIcms',
    summary: 'Push a referral to ICMS and store the case number (analyst)',
  })
  @ApiOkResponse({ description: 'Registered (or already registered), or pushed' })
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(404, 'Not in the intake')
  @ApiProblemResponse(502, 'Problem code `icms-push-failed`: left push-failed, push again')
  @ApiProblemResponse(503, 'The workflow engine could not be reached')
  push(
    @CurrentPrincipal() principal: Principal,
    @Param('referralId', new ZodValidationPipe(z.uuid())) referralId: string,
  ): Promise<ReferralIntakeItem> {
    return this.referrals.push(principal, referralId);
  }
}
