import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  Roles,
  schemaRef,
  TENANT_KEY,
  ZodValidationPipe,
} from '@adili/api-kit';
import { ACCESS_OFFICER, EACC_ROLES, SUPERVISOR } from '@adili/roles';
import { z } from 'zod';

import {
  type QueuePage,
  type QueueQuery,
  queueQuery,
  type ResolveOfficerBody,
  resolveOfficerBody,
  type RosterCandidates,
  type RosterCandidatesQuery,
  rosterCandidatesQuery,
} from './officer-representation.js';
import type { OfficerRequestView } from './officer-view.js';
import { OfficerService } from './officer.service.js';

const REQUEST_ID = { name: 'requestId', schema: { type: 'string', format: 'uuid' } } as const;

/**
 * Who reaches these routes: the Commission's access officer and supervisor, and EACC, whose roles
 * see nothing here (spec 10): they get 404, as for another Commission's requests, not 403.
 */
const OFFICER_ROUTE_ROLES = [ACCESS_OFFICER, SUPERVISOR, ...EACC_ROLES] as const;

const NOT_THE_COMMISSIONS =
  "No such request at the caller's Commission (another Commission's, EACC's or anyone else's view)";

/** The Commission's access requests as its access officer works them and its supervisor reads them. */
@ApiTags('officer')
@Controller()
export class OfficerController {
  constructor(private readonly officer: OfficerService) {}

  @Get('v1/commissions/:slug/access/requests')
  @Roles(...OFFICER_ROUTE_ROLES)
  @ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } })
  @ApiOperation({
    operationId: 'listCommissionAccessRequests',
    summary: 'Queue of access requests with deadlines (access officer; supervisor reads)',
    description:
      'Earliest decision deadline first. `late`: past the deadline and neither decided nor closed. Law enforcement requests join the queue with their own workspace (`kind=lea` is empty until then).',
  })
  @ApiQueryParameters(queueQuery)
  @ApiOkResponse({ description: 'Page', schema: schemaRef('QueuePage') })
  @ApiProblemResponse(400, 'Query failed validation, or an unknown cursor')
  @ApiProblemResponse(404, "Not the caller's Commission")
  queue(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(queueQuery)) query: QueueQuery,
  ): Promise<QueuePage> {
    return this.officer.queue(principal, slug, query);
  }

  @Get('v1/access/requests/:requestId/officer')
  @Roles(...OFFICER_ROUTE_ROLES)
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'getAccessRequestForOfficer',
    summary: 'Full request for the access officer (Form K, representations, register)',
  })
  @ApiOkResponse({ description: 'Request', schema: schemaRef('OfficerRequestView') })
  @ApiProblemResponse(400, 'requestId is not a UUID')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(503, 'The key service cannot be reached')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
  ): Promise<OfficerRequestView> {
    return this.officer.get(principal, requestId);
  }

  @Get('v1/access/requests/:requestId/roster-candidates')
  @Roles(...OFFICER_ROUTE_ROLES)
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'listRosterCandidates',
    summary: "Search the Commission's roster for the officer a request names (access officer)",
    description:
      'By personnel file number (its beginning) or part of the name, at most 20 records by full name. Only an `onboarded` record can be chosen: its declarant is notified.',
  })
  @ApiQueryParameters(rosterCandidatesQuery)
  @ApiOkResponse({ description: 'Records', schema: schemaRef('RosterCandidates') })
  @ApiProblemResponse(400, 'requestId is not a UUID, or no search of at least 2 characters')
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(503, 'The directory cannot be reached')
  rosterCandidates(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Query(new ZodValidationPipe(rosterCandidatesQuery)) query: RosterCandidatesQuery,
  ): Promise<RosterCandidates> {
    return this.officer.rosterCandidates(principal, requestId, query.q);
  }

  @Post('v1/access/requests/:requestId/resolve')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICER_ROUTE_ROLES)
  @AcceptIdempotencyKey()
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'resolveRequestedOfficer',
    summary: 'Identify the officer on the roster, or record that they cannot be identified',
    description:
      'A roster record: the declarant is notified next (`awaiting-representations`, with the window for representations). `rosterRecordId: null`: the request closes as `cannot-identify` (`access.request.cannot-identify.v1`, Form M decline reason `other`) and the applicant is told.',
  })
  @ApiBody({ required: true, schema: schemaRef('ResolveOfficer') })
  @ApiOkResponse({
    description: 'Resolved; the declarant notification follows, or the request is closed',
    schema: schemaRef('OfficerRequestView'),
  })
  @ApiProblemResponse(
    400,
    'requestId is not a UUID, the body failed validation, or `rosterRecordId` is not an onboarded roster record of the Commission',
  )
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(
    409,
    "Problem code `officer-resolved` (once only), `request-closed` or `request-decided`; or the applicant's identity is still to be verified",
  )
  @ApiProblemResponse(503, 'The directory cannot be reached; nothing was recorded')
  resolve(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(resolveOfficerBody)) body: ResolveOfficerBody,
  ): Promise<OfficerRequestView> {
    return this.officer.resolve(principal, requestId, body);
  }
}
