import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
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
  CurrentReadAudit,
  type Principal,
  type ReadAudit,
  RequireIdempotencyKey,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { LAW_ENFORCEMENT } from '@adili/roles';
import { z } from 'zod';

import { OFFICER_ROUTE_ROLES } from '../access.js';
import { type DecisionInput, decisionInputSchema } from '../decision.js';
import {
  type RosterCandidates,
  type RosterCandidatesQuery,
  rosterCandidatesQuery,
} from '../requests/officer-representation.js';
import { type WrittenNoticeBody, writtenNoticeBody } from '../written-notice.js';
import { LeaService } from './lea.service.js';
import {
  type LeaRequest,
  type LeaRequestInput,
  leaRequestInputSchema,
  type VerifyLeaRequestBody,
  verifyLeaRequestBody,
} from './representation.js';

const LEA_REQUEST_ID = {
  name: 'leaRequestId',
  schema: { type: 'string', format: 'uuid' },
} as const;

const NOT_VISIBLE =
  "No such request of the caller's (another officer's, another Commission's, EACC's or anyone else's view)";

/** Law enforcement requests: filed and followed by the officer, verified and decided by the Commission. */
@ApiTags('lea')
@Controller('v1/lea/requests')
export class LeaController {
  constructor(private readonly lea: LeaService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(LAW_ENFORCEMENT)
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'submitLeaRequest',
    summary:
      'Law enforcement officer submits a written request (no Form K); allocates the LEA reference',
    description:
      "From a provisioned, active officer account (role `law-enforcement`, tenant `lea`, the token's `person_id` an officer of an agency in the directory). The request is `received` (`lea.request.received.v1`) with its fourteen-day deadline; the declarant is not told (only after a grant, r.23(2)).",
  })
  @ApiBody({ required: true, schema: schemaRef('LeaRequestInput') })
  @ApiCreatedResponse({ description: 'Received', schema: schemaRef('LeaRequest') })
  @ApiProblemResponse(
    400,
    'The body failed validation (`errors` name the fields), or no such Responsible Commission (`commission`)',
  )
  @ApiProblemResponse(
    403,
    'Not a law enforcement officer account, or not an active one of an agency in the directory',
  )
  @ApiProblemResponse(503, 'The directory or Temporal cannot be reached; nothing was stored')
  submit(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(leaRequestInputSchema)) body: LeaRequestInput,
  ): Promise<LeaRequest> {
    return this.lea.submit(principal, body);
  }

  @Get()
  @Roles(LAW_ENFORCEMENT)
  @ApiOperation({
    operationId: 'listMyLeaRequests',
    summary: "The officer's requests, latest first",
    description:
      'Their own only, across Commissions. Each timeline names no actor but the officer.',
  })
  @ApiOkResponse({
    description: 'Requests',
    schema: { type: 'array', items: schemaRef('LeaRequest') },
  })
  @ApiProblemResponse(403, 'Not a law enforcement officer account')
  list(@CurrentPrincipal() principal: Principal): Promise<LeaRequest[]> {
    return this.lea.list(principal);
  }

  @Get(':leaRequestId')
  @Roles(LAW_ENFORCEMENT, ...OFFICER_ROUTE_ROLES)
  @AuditedRead({ action: 'lea.request.viewed', resource: 'lea-request' })
  @ApiParam(LEA_REQUEST_ID)
  @ApiOperation({
    operationId: 'getLeaRequest',
    summary: "One request (the officer who filed it, or the Commission's access officer; audited)",
    description:
      "The officer who filed it sees it with only their own name on the timeline; the Commission's access officer and supervisor see it whole. The package (`package.documentId`) is downloaded by the filing officer from documents until `package.downloadExpiresAt`.",
  })
  @ApiOkResponse({ description: 'Request', schema: schemaRef('LeaRequest') })
  @ApiProblemResponse(400, 'leaRequestId is not a UUID')
  @ApiProblemResponse(403, 'A law enforcement account without an officer record')
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('leaRequestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<LeaRequest> {
    return this.lea.get(principal, requestId, audit);
  }

  @Post(':leaRequestId/withdraw')
  @HttpCode(HttpStatus.OK)
  @Roles(LAW_ENFORCEMENT)
  @RequireIdempotencyKey()
  @ApiParam(LEA_REQUEST_ID)
  @ApiOperation({
    operationId: 'withdrawLeaRequest',
    summary: 'The filing officer withdraws their request before a decision',
    description:
      "Only the officer who filed it, while it is `received` or `verified`. It becomes `withdrawn` (`lea.request.withdrawn.v1`, in the access register) and the Commission's access officers are told by email; the declarant is never told. Idempotent per Idempotency-Key.",
  })
  @ApiOkResponse({ description: 'Withdrawn', schema: schemaRef('LeaRequest') })
  @ApiProblemResponse(400, 'leaRequestId is not a UUID')
  @ApiProblemResponse(403, 'Not a law enforcement officer account')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem code `request-decided` (a decision is final) or `request-closed` (withdrawn already)',
  )
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('leaRequestId', new ZodValidationPipe(z.uuid())) requestId: string,
  ): Promise<LeaRequest> {
    return this.lea.withdraw(principal, requestId);
  }

  @Get(':leaRequestId/roster-candidates')
  @Roles(...OFFICER_ROUTE_ROLES)
  @AuditedRead({ action: 'lea.roster-candidates.listed', resource: 'roster-record' })
  @ApiTags('officer')
  @ApiParam(LEA_REQUEST_ID)
  @ApiOperation({
    operationId: 'listLeaRosterCandidates',
    summary:
      "Search the Commission's roster for the officer a law enforcement request names (audited)",
    description:
      'As for Form K: by personnel file number (its beginning) or part of the name, at most 20 records by full name. Only an `onboarded` record can be chosen when verifying: its declarant is told after a grant.',
  })
  @ApiQueryParameters(rosterCandidatesQuery)
  @ApiOkResponse({ description: 'Records', schema: schemaRef('RosterCandidates') })
  @ApiProblemResponse(400, 'leaRequestId is not a UUID, or no search of at least 2 characters')
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(503, 'The directory cannot be reached')
  rosterCandidates(
    @CurrentPrincipal() principal: Principal,
    @Param('leaRequestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Query(new ZodValidationPipe(rosterCandidatesQuery)) query: RosterCandidatesQuery,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<RosterCandidates> {
    return this.lea.rosterCandidates(principal, requestId, query.q, audit);
  }

  @Post(':leaRequestId/verify')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICER_ROUTE_ROLES)
  @AcceptIdempotencyKey()
  @ApiTags('officer')
  @ApiParam(LEA_REQUEST_ID)
  @ApiOperation({
    operationId: 'verifyLeaRequest',
    summary: 'Access officer records the provenance and reason check and identifies the officer',
    description:
      "r.23(1): the access officer confirms the request comes from the agency account it shows (checked again against the directory) and states its reason, and identifies the officer sought on the Commission's roster. The request becomes `verified` (`lea.request.verified.v1`).",
  })
  @ApiBody({ required: true, schema: schemaRef('VerifyLeaRequest') })
  @ApiOkResponse({ description: 'Verified', schema: schemaRef('LeaRequest') })
  @ApiProblemResponse(
    400,
    'leaRequestId is not a UUID, the body failed validation, or `rosterRecordId` is not a roster record of the Commission',
  )
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem code `officer-resolved` (verified already), `request-decided` or `request-closed`; or `lea-account-inactive`: the account the request came from is no longer an active officer account of its agency (deny it instead)',
  )
  @ApiProblemResponse(503, 'The directory cannot be reached; nothing was recorded')
  verify(
    @CurrentPrincipal() principal: Principal,
    @Param('leaRequestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(verifyLeaRequestBody)) body: VerifyLeaRequestBody,
  ): Promise<LeaRequest> {
    return this.lea.verify(principal, requestId, body);
  }

  @Post(':leaRequestId/written-notice')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICER_ROUTE_ROLES)
  @AcceptIdempotencyKey()
  @ApiTags('officer')
  @ApiParam(LEA_REQUEST_ID)
  @ApiOperation({
    operationId: 'recordLeaWrittenNotice',
    summary: 'Record the written notice of a grant served on a declarant with no account',
    description:
      'r.23(2), spec 10 decision 2: the officer identified has no declarant account, so the access officer tells them of the grant in writing and records the day it was served (not in the future, not before the grant). The request records the declarant told (`declarantNotice.channel` `written`; `lea.request.notified.v1`). They were invited to onboard; once they do, the notice shows in their account.',
  })
  @ApiBody({ required: true, schema: schemaRef('WrittenNotice') })
  @ApiOkResponse({ description: 'Recorded', schema: schemaRef('LeaRequest') })
  @ApiProblemResponse(
    400,
    'leaRequestId is not a UUID, or the body failed validation: `notifiedOn` in the future or before the grant',
  )
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem code `declarant-notified` (told already), `not-under-decision` (not granted yet) or `request-closed`; or the request was denied, or the declarant has an account (told online)',
  )
  recordWrittenNotice(
    @CurrentPrincipal() principal: Principal,
    @Param('leaRequestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(writtenNoticeBody)) body: WrittenNoticeBody,
  ): Promise<LeaRequest> {
    return this.lea.recordWrittenNotice(principal, requestId, body);
  }

  @Post(':leaRequestId/decision')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICER_ROUTE_ROLES)
  @RequireIdempotencyKey()
  @ApiTags('officer')
  @ApiParam(LEA_REQUEST_ID)
  @ApiOperation({
    operationId: 'decideLeaRequest',
    summary: 'Grant (package, declarant notified after) or deny with reasons (final)',
    description:
      "As for Form K: a grant is of the requested scope and cites no grounds; a partial grant narrows it and cites Regulation 24 grounds; a denial cites grounds. A grant or partial grant needs the request `verified`; a denial may be decided before. The request becomes `granted` (in full or in part: see `decision.outcome`) or `denied` (`lea.request.decided.v1`). The agency's officer is told next; after a grant the declarant is told (r.23(2)) and the officer's package (`act-s36-2`) follows.",
  })
  @ApiBody({ required: true, schema: schemaRef('DecisionInput') })
  @ApiOkResponse({
    description: 'Decided; notices and package follow',
    schema: schemaRef('LeaRequest'),
  })
  @ApiProblemResponse(
    400,
    'leaRequestId is not a UUID or the body failed validation; problem code `grounds-required` or `scope-exceeds-request`; `errors` name the field',
  )
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem code `request-decided` (a decision is final), `request-closed`, or `not-under-decision` (a grant before the request is verified)',
  )
  decide(
    @CurrentPrincipal() principal: Principal,
    @Param('leaRequestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(decisionInputSchema)) body: DecisionInput,
  ): Promise<LeaRequest> {
    return this.lea.decide(principal, requestId, body);
  }
}
