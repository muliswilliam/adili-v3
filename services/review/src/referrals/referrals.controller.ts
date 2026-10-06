import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  TENANT_KEY,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { type ReasonInput, reasonInput } from '../determinations/determination-input.js';
import {
  type ReferralInput,
  referralInput,
  type ReferralsQuery,
  referralsQuery,
} from './referral-input.js';
import { type ReferralPage, ReferralsService } from './referrals.service.js';
import type { ReferralView } from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';
const DECIDER =
  'Problem code `separation-of-duties` (the caller proposed it or held one of its cases) or `supervisor-required`';

const uuidParam = z.uuid();

const ApiUuidParam = (name: string) =>
  ApiParam({ name, schema: { type: 'string', format: 'uuid' } });

/**
 * Referrals to EACC for the Commission's reviewers and supervisors (spec 08): the case's assignee
 * proposes one from a case with registry or comparison flags; a supervisor who neither proposed it
 * nor held its cases approves (RFL, evidence package, sent to EACC) or declines it. Anyone outside
 * the Commission's review staff gets 404; the declarant never sees a referral.
 */
@ApiTags('referrals')
@Controller('v1')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Post('review/cases/:caseId/referrals')
  @ApiUuidParam('caseId')
  @AcceptIdempotencyKey()
  @ApiBody({ required: true, schema: schemaRef('ReferralInput') })
  @ApiOperation({
    operationId: 'proposeReferral',
    summary: 'Propose a referral to EACC from a case (assignee)',
  })
  @ApiCreatedResponse({ description: 'Proposed', schema: schemaRef('Referral') })
  @ApiProblemResponse(
    400,
    'Body failed validation, or a flag is not a registry or comparison flag of the case, or a clarification not an issued one of the case',
  )
  @ApiProblemResponse(403, 'Problem code `not-the-assignee`')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `referral-open`: one from this case waits for approval')
  propose(
    @CurrentPrincipal() principal: Principal,
    @Param('caseId', new ZodValidationPipe(uuidParam)) caseId: string,
    @Body(new ZodValidationPipe(referralInput)) body: ReferralInput,
  ): Promise<ReferralView> {
    return this.referrals.propose(principal, caseId, body);
  }

  @Get('commissions/:slug/referrals')
  @ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } })
  @ApiOperation({ operationId: 'listReferrals', summary: 'Referrals of the Commission' })
  @ApiQueryParameters(referralsQuery)
  @ApiOkResponse({
    description: 'Page, newest proposal first',
    schema: {
      type: 'object',
      required: ['items', 'nextCursor'],
      properties: {
        items: { type: 'array', items: schemaRef('Referral') },
        nextCursor: { type: ['string', 'null'] },
      },
    },
  })
  @ApiProblemResponse(400, 'Query failed validation, or the cursor is unknown')
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(referralsQuery)) query: ReferralsQuery,
  ): Promise<ReferralPage> {
    return this.referrals.list(principal, slug, query);
  }

  @Get('review/referrals/:referralId')
  @AuditedRead({ action: 'review.referral.viewed', resource: 'referral' })
  @ApiUuidParam('referralId')
  @ApiOperation({
    operationId: 'getReferral',
    summary: 'One referral with its package manifest, or what its package will include',
    description:
      'A Confidential read, audited like a case view (ADR-008): every call records an audit.read.v1 `review.referral.viewed` with the viewer and the referral.',
  })
  @ApiOkResponse({ description: 'Referral', schema: schemaRef('Referral') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('referralId', new ZodValidationPipe(uuidParam)) referralId: string,
  ): Promise<ReferralView> {
    return this.referrals.get(principal, referralId);
  }

  @Post('review/referrals/:referralId/approve')
  @HttpCode(200)
  @RequireIdempotencyKey()
  @ApiUuidParam('referralId')
  @ApiOperation({
    operationId: 'approveReferral',
    summary:
      'Approve (supervisor, separation rule); allocates RFL, then assembles the package and sends to EACC',
  })
  @ApiOkResponse({
    description: 'Approved; the package is assembled and the referral sent in the background',
    schema: schemaRef('Referral'),
  })
  @ApiProblemResponse(403, DECIDER)
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `not-proposed`')
  @ApiProblemResponse(503, 'The Commission directory could not be reached; nothing changed')
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('referralId', new ZodValidationPipe(uuidParam)) referralId: string,
  ): Promise<ReferralView> {
    return this.referrals.approve(principal, referralId);
  }

  @Post('review/referrals/:referralId/decline')
  @HttpCode(200)
  @ApiUuidParam('referralId')
  @AcceptIdempotencyKey()
  @ApiBody({ required: true, schema: schemaRef('ReasonInput') })
  @ApiOperation({ operationId: 'declineReferral', summary: 'Decline with a note' })
  @ApiOkResponse({ description: 'Declined', schema: schemaRef('Referral') })
  @ApiProblemResponse(400, 'Body failed validation')
  @ApiProblemResponse(403, DECIDER)
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Problem code `not-proposed`')
  decline(
    @CurrentPrincipal() principal: Principal,
    @Param('referralId', new ZodValidationPipe(uuidParam)) referralId: string,
    @Body(new ZodValidationPipe(reasonInput)) body: ReasonInput,
  ): Promise<ReferralView> {
    return this.referrals.decline(principal, referralId, body);
  }
}
