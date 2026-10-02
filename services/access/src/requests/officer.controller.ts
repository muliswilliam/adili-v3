import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  CurrentReadAudit,
  type Principal,
  RequireIdempotencyKey,
  ReadAudit,
  Roles,
  schemaRef,
  TENANT_KEY,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { OFFICER_ROUTE_ROLES } from '../access.js';
import { type DecisionInput, decisionInputSchema } from '../decision.js';
import {
  type RepresentationsInput,
  representationsInputSchema,
} from '../notices/representation.js';
import { type WrittenNoticeBody, writtenNoticeBody } from '../written-notice.js';
import {
  type AttachmentDownload,
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
      'Form K requests (30-day deadline) and law enforcement requests (14-day deadline) together, or one `kind`. Open requests first, earliest decision deadline first; then decided and closed ones, latest deadline first. `late`: past the deadline and neither decided nor closed (for a law enforcement request, the breach flag). Filters combine (`status`, `kind`, `late`, `search`).',
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
  @AuditedRead({ action: 'access.request.viewed', resource: 'access-request' })
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'getAccessRequestForOfficer',
    summary: 'Full request for the access officer (Form K, representations, register; audited)',
    description:
      "The Commission's access officer and supervisor read it; another Commission's request, and EACC, get 404. The timeline is the request's whole access register, actors named.",
  })
  @ApiOkResponse({ description: 'Request', schema: schemaRef('OfficerRequestView') })
  @ApiProblemResponse(400, 'requestId is not a UUID')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(503, 'The key service cannot be reached')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<OfficerRequestView> {
    return this.officer.get(principal, requestId, audit);
  }

  @Get('v1/access/requests/:requestId/representations/attachments/:uploadId/download')
  @Roles(...OFFICER_ROUTE_ROLES)
  @AuditedRead({
    action: 'access.representations.attachment.downloaded',
    resource: 'access-request',
  })
  @ApiParam(REQUEST_ID)
  @ApiParam({ name: 'uploadId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getRepresentationAttachmentDownload',
    summary:
      "Short-lived download link for a file attached to the declarant's representations (audited)",
    description:
      'The access officer and the supervisor of the Commission read the representations, attachments included.',
  })
  @ApiOkResponse({ description: 'Link', schema: schemaRef('AttachmentDownload') })
  @ApiProblemResponse(400, 'requestId or uploadId is not a UUID')
  @ApiProblemResponse(
    404,
    `${NOT_THE_COMMISSIONS}; or the upload is not attached to its representations`,
  )
  @ApiProblemResponse(503, 'The documents service cannot be reached')
  representationAttachmentDownload(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Param('uploadId', new ZodValidationPipe(z.uuid())) uploadId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<AttachmentDownload> {
    return this.officer.representationAttachmentDownload(principal, requestId, uploadId, audit);
  }

  @Get('v1/access/requests/:requestId/roster-candidates')
  @Roles(...OFFICER_ROUTE_ROLES)
  @AuditedRead({ action: 'access.roster-candidates.listed', resource: 'roster-record' })
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'listRosterCandidates',
    summary:
      "Search the Commission's roster for the officer a request names (access officer; audited)",
    description:
      "By personnel file number (its beginning) or part of the name, at most 20 records by full name. Any can be chosen: an `onboarded` record's declarant is notified online; the officer of one not onboarded is invited to onboard and served a written notice (spec 10 decision 2).",
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
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<RosterCandidates> {
    return this.officer.rosterCandidates(principal, requestId, query.q, audit);
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
      'A roster record: the declarant is notified next (`awaiting-representations`, with the window for representations). A record whose officer has not onboarded (`declarantOnboarded: false`): they are invited to onboard, and the request waits for the access officer to record the written notice served on them (`recordWrittenNotice`), or for them to onboard. `rosterRecordId: null`: the request closes as `cannot-identify` (`access.request.cannot-identify.v1`, Form M decline reason `other`) and the applicant is told.',
  })
  @ApiBody({ required: true, schema: schemaRef('ResolveOfficer') })
  @ApiOkResponse({
    description: 'Resolved; the declarant notification follows, or the request is closed',
    schema: schemaRef('OfficerRequestView'),
  })
  @ApiProblemResponse(
    400,
    'requestId is not a UUID, the body failed validation, or `rosterRecordId` is not a roster record of the Commission',
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

  @Post('v1/access/requests/:requestId/written-notice')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICER_ROUTE_ROLES)
  @AcceptIdempotencyKey()
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'recordWrittenNotice',
    summary: 'Record the written notice served on a declarant with no account (r.22(2))',
    description:
      "Spec 10 decision 2: the officer identified has not onboarded, so the access officer serves the notice in writing and records the day (not in the future, not before the officer was identified). The request becomes `awaiting-representations`, notified from the start of that day (`notice.channel` `written`, `access.request.notified.v1`), and the window for representations ends at the end of the seventh day after it. The declarant's representations received in writing are entered with `enterRepresentationsReceivedInWriting`.",
  })
  @ApiBody({ required: true, schema: schemaRef('WrittenNotice') })
  @ApiOkResponse({ description: 'Recorded', schema: schemaRef('OfficerRequestView') })
  @ApiProblemResponse(
    400,
    'requestId is not a UUID, or the body failed validation: `notifiedOn` in the future or before the officer was identified',
  )
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(
    409,
    'Problem code `declarant-notified` (notified already, online or in writing), `request-closed` or `request-decided`; or the officer is not identified yet, or has an account (notified online)',
  )
  recordWrittenNotice(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(writtenNoticeBody)) body: WrittenNoticeBody,
  ): Promise<OfficerRequestView> {
    return this.officer.recordWrittenNotice(principal, requestId, body);
  }

  @Post('v1/access/requests/:requestId/decision-written-notice')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICER_ROUTE_ROLES)
  @AcceptIdempotencyKey()
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'recordDecisionWrittenNotice',
    summary: 'Record the decision served in writing on a declarant with no account',
    description:
      'Spec 10 decision 2: a declarant with no account cannot be told the decision online, so the access officer serves it in writing and records the day (not in the future, not before the decision): `decisionNotice` on the request, `access.request.decision-notified.v1`. The declarant who onboards later is also told the outcome online.',
  })
  @ApiBody({ required: true, schema: schemaRef('WrittenNotice') })
  @ApiOkResponse({ description: 'Recorded', schema: schemaRef('OfficerRequestView') })
  @ApiProblemResponse(
    400,
    'requestId is not a UUID, or the body failed validation: `notifiedOn` in the future or before the decision',
  )
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(
    409,
    'Problem code `not-under-decision` (not decided yet), `declarant-notified` (recorded already) or `request-closed`; or the declarant has an account (told online)',
  )
  recordDecisionWrittenNotice(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(writtenNoticeBody)) body: WrittenNoticeBody,
  ): Promise<OfficerRequestView> {
    return this.officer.recordDecisionWrittenNotice(principal, requestId, body);
  }

  @Put('v1/access/requests/:requestId/representations')
  @Roles(...OFFICER_ROUTE_ROLES)
  @AcceptIdempotencyKey()
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'enterRepresentationsReceivedInWriting',
    summary: "Enter the declarant's representations received in writing, on their behalf",
    description:
      "Spec 10 decision 2: on a request notified in writing, while the window is open, the access officer enters what the declarant answered on paper: stance, text, and the letter's scans (the officer's clean uploads of purpose `access-representation`). They show as received in writing (`representations.receivedInWriting`), with the officer who entered them (`access.request.representations.v1`); `consent` sends the request `under-decision` at once. Entering them again replaces them, as the declarant's own do.",
  })
  @ApiBody({ required: true, schema: schemaRef('RepresentationsInput') })
  @ApiOkResponse({ description: 'Saved', schema: schemaRef('OfficerRequestView') })
  @ApiProblemResponse(
    400,
    'requestId is not a UUID, the body failed validation, or an attachment is not a clean `access-representation` upload of the caller (`attachments.<n>`)',
  )
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(
    409,
    'Problem code `representations-closed` (the window is closed, or not open yet), `request-closed` or `request-decided`; or the declarant was notified online (they make their own)',
  )
  @ApiProblemResponse(503, 'The documents service cannot be reached; nothing was saved')
  enterRepresentations(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(representationsInputSchema)) body: RepresentationsInput,
  ): Promise<OfficerRequestView> {
    return this.officer.enterRepresentations(principal, requestId, body);
  }

  @Post('v1/access/requests/:requestId/decision')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICER_ROUTE_ROLES)
  @RequireIdempotencyKey()
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'decideAccessRequest',
    summary:
      'Grant, partially grant or deny (final; Regulation 24 grounds required for partial and deny)',
    description:
      "Only once the request is `under-decision`. A grant is of the requested scope and cites no grounds; a partial grant narrows the scope and cites grounds; a denial cites grounds. The request becomes `granted`, `partially-granted` or `denied` (`access.request.decided.v1` with outcome and grounds). The applicant and the declarant are told next; for a grant the applicant's package (`package.documentId`, downloadable by the applicant from documents until `package.downloadExpiresAt`) follows.",
  })
  @ApiBody({ required: true, schema: schemaRef('DecisionInput') })
  @ApiOkResponse({
    description: 'Decided; notifications and package follow',
    schema: schemaRef('OfficerRequestView'),
  })
  @ApiProblemResponse(
    400,
    'requestId is not a UUID or the body failed validation; problem code `grounds-required` (partial grant or denial without grounds) or `scope-exceeds-request` (`grantedScope` wider than the request); `errors` name the field',
  )
  @ApiProblemResponse(403, 'The Commission supervisor reads requests; only its access officer acts')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(
    409,
    'Problem code `request-decided` (a decision is final), `request-closed`, or `not-under-decision` (the window for representations is still open, or the officer is unresolved)',
  )
  decide(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(decisionInputSchema)) body: DecisionInput,
  ): Promise<OfficerRequestView> {
    return this.officer.decide(principal, requestId, body);
  }
}
