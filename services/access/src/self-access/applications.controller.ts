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
  TENANT_KEY,
  ZodValidationPipe,
} from '@adili/api-kit';
import { ACCESS_OFFICER, EACC_ROLES, SUPERVISOR } from '@adili/roles';
import { z } from 'zod';

import {
  type RosterCandidates,
  type RosterCandidatesQuery,
  rosterCandidatesQuery,
} from '../requests/officer-representation.js';
import {
  type DeclarantVersions,
  type SelfAccessApplicationDetail,
  type SelfAccessApplicationInput,
  selfAccessApplicationInputSchema,
  type SelfAccessListQuery,
  selfAccessListQuery,
  type SelfAccessPage,
} from './application-representation.js';
import { SelfAccessApplicationsService } from './applications.service.js';

/** The Commission's access officer and supervisor, and EACC, who gets 404 here (spec 10 S16). */
const ROUTE_ROLES = [ACCESS_OFFICER, SUPERVISOR, ...EACC_ROLES] as const;

const SLUG = { name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } } as const;
const APPLICATION_ID = {
  name: 'applicationId',
  schema: { type: 'string', format: 'uuid' },
} as const;

const SUPERVISOR_READS =
  'The Commission supervisor reads applications; only its access officer acts';
const NOT_THE_COMMISSIONS =
  "Not the caller's Commission (another Commission's, EACC's or anyone else's)";

/**
 * Written self-access applications (spec 10, Administrative Mechanism 32): a declarant who
 * cannot use the portal, or their representative, applies in writing at the Commission for a
 * certified copy of a declaration; the access officer records it, the copy is issued as the
 * portal's are, and the officer marks it collected or dispatched.
 */
@ApiTags('officer')
@Controller()
export class SelfAccessApplicationsController {
  constructor(private readonly applications: SelfAccessApplicationsService) {}

  @Get('v1/commissions/:slug/access/self-access/declarants')
  @Roles(...ROUTE_ROLES)
  @AuditedRead({ action: 'access.self-access.declarants.listed', resource: 'roster-record' })
  @ApiParam(SLUG)
  @ApiOperation({
    operationId: 'searchSelfAccessDeclarants',
    summary:
      "Search the Commission's roster for the declarant of a written self-access application",
    description:
      'By personnel file number (its beginning) or part of the name, at most 20 records by full name. Only an `onboarded` record has declarations to copy.',
  })
  @ApiQueryParameters(rosterCandidatesQuery)
  @ApiOkResponse({ description: 'Records', schema: schemaRef('RosterCandidates') })
  @ApiProblemResponse(400, 'No search of at least 2 characters')
  @ApiProblemResponse(403, SUPERVISOR_READS)
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(503, 'The directory cannot be reached')
  declarants(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(rosterCandidatesQuery)) query: RosterCandidatesQuery,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<RosterCandidates> {
    return this.applications.declarants(principal, slug, query.q, audit);
  }

  @Get('v1/commissions/:slug/access/self-access/declarants/:rosterRecordId/versions')
  @Roles(...ROUTE_ROLES)
  @AuditedRead({ action: 'access.self-access.versions.listed', resource: 'roster-record' })
  @ApiParam(SLUG)
  @ApiParam({ name: 'rosterRecordId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'listSelfAccessDeclarantVersions',
    summary: "The declarant's submitted versions a certified copy can be of",
    description:
      'Latest submitted first, with the reference, type, statement date and whether a later version replaced it; no content. Empty for a record not onboarded.',
  })
  @ApiOkResponse({ description: 'Versions', schema: schemaRef('DeclarantVersions') })
  @ApiProblemResponse(400, 'rosterRecordId is not a UUID')
  @ApiProblemResponse(403, SUPERVISOR_READS)
  @ApiProblemResponse(404, `${NOT_THE_COMMISSIONS}, or no such roster record of the Commission`)
  @ApiProblemResponse(503, 'The directory or declarations cannot be reached')
  declarantVersions(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('rosterRecordId', new ZodValidationPipe(z.uuid())) rosterRecordId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<DeclarantVersions> {
    return this.applications.declarantVersions(principal, slug, rosterRecordId, audit);
  }

  @Post('v1/commissions/:slug/access/self-access')
  @Roles(...ROUTE_ROLES)
  @RequireIdempotencyKey()
  @ApiParam(SLUG)
  @ApiOperation({
    operationId: 'recordSelfAccessApplication',
    summary: 'Record a written self-access application and issue its certified copy',
    description:
      "The declarant's identity check, and for a representative their name, ID number (stored encrypted), written authority and ID as the officer's clean uploads of purpose `access-representation`. The certified copy (Restricted, the declarant its subject) is ordered at once and due 14 days from receipt; once issued it is registered `self-access` naming the representative (`access.certified-copy.issued.v1`) and shows in the declarant's access history. Follow `certifiedCopy.status` until `issued`; the recording officer (`recordedByCaller`) is named on the copy and downloads it from documents (`getDocumentDownload` with `certifiedCopy.documentId`, audited there) to print it, then marks it collected or dispatched.",
  })
  @ApiBody({ required: true, schema: schemaRef('SelfAccessApplicationInput') })
  @ApiCreatedResponse({
    description: 'Recorded; the certified copy is being issued',
    schema: schemaRef('SelfAccessApplicationDetail'),
  })
  @ApiProblemResponse(
    400,
    'The body failed validation; `rosterRecordId` is not an onboarded roster record of the Commission, `version` not a submitted version of its declarant, or a representative upload not a clean `access-representation` upload of the caller; `errors` name the field',
  )
  @ApiProblemResponse(403, SUPERVISOR_READS)
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(
    503,
    'The directory, declarations, documents, the key service or the workflow engine cannot be reached; nothing was recorded',
  )
  record(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(selfAccessApplicationInputSchema)) body: SelfAccessApplicationInput,
  ): Promise<SelfAccessApplicationDetail> {
    return this.applications.record(principal, slug, body);
  }

  @Get('v1/commissions/:slug/access/self-access')
  @Roles(...ROUTE_ROLES)
  @ApiParam(SLUG)
  @ApiOperation({
    operationId: 'listSelfAccessApplications',
    summary: "The Commission's written self-access applications with their deadlines",
    description:
      'Those still to collect or dispatch first, earliest deadline first; then the delivered ones, latest deadline first. `late`: the certified copy was not issued by the deadline (14 days from receipt).',
  })
  @ApiQueryParameters(selfAccessListQuery)
  @ApiOkResponse({ description: 'Page', schema: schemaRef('SelfAccessPage') })
  @ApiProblemResponse(400, 'Query failed validation, or an unknown cursor')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(selfAccessListQuery)) query: SelfAccessListQuery,
  ): Promise<SelfAccessPage> {
    return this.applications.list(principal, slug, query);
  }

  @Get('v1/access/self-access/:applicationId')
  @Roles(...ROUTE_ROLES)
  @AuditedRead({ action: 'access.self-access.viewed', resource: 'self-access-application' })
  @ApiParam(APPLICATION_ID)
  @ApiOperation({
    operationId: 'getSelfAccessApplication',
    summary: "A written self-access application, with the representative's ID number",
    description:
      "The Commission's access officer and supervisor read it; another Commission's application, and EACC, get 404. `recordedByCaller`: the caller recorded it, so may download the issued certified copy to hand it over.",
  })
  @ApiOkResponse({ description: 'Application', schema: schemaRef('SelfAccessApplicationDetail') })
  @ApiProblemResponse(400, 'applicationId is not a UUID')
  @ApiProblemResponse(404, "No such application at the caller's Commission")
  @ApiProblemResponse(503, 'The key service cannot be reached')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', new ZodValidationPipe(z.uuid())) applicationId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<SelfAccessApplicationDetail> {
    return this.applications.get(principal, applicationId, audit);
  }

  @Post('v1/access/self-access/:applicationId/delivered')
  @HttpCode(HttpStatus.OK)
  @Roles(...ROUTE_ROLES)
  @AcceptIdempotencyKey()
  @ApiParam(APPLICATION_ID)
  @ApiOperation({
    operationId: 'markSelfAccessDelivered',
    summary: 'Mark the issued certified copy collected or dispatched',
    description:
      'As the application was marked (`deliveryMethod`); the application becomes `delivered`. Only once the certified copy is issued, and once.',
  })
  @ApiOkResponse({ description: 'Marked', schema: schemaRef('SelfAccessApplicationDetail') })
  @ApiProblemResponse(400, 'applicationId is not a UUID')
  @ApiProblemResponse(403, SUPERVISOR_READS)
  @ApiProblemResponse(404, "No such application at the caller's Commission")
  @ApiProblemResponse(409, 'The certified copy is not issued yet, or is marked already')
  @ApiProblemResponse(503, 'The key service cannot be reached')
  markDelivered(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', new ZodValidationPipe(z.uuid())) applicationId: string,
  ): Promise<SelfAccessApplicationDetail> {
    return this.applications.markDelivered(principal, applicationId);
  }
}
