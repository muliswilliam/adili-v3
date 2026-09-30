import { Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  IdempotencyKey,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
} from '@adili/api-kit';

import type { Declaration } from '../drafts/representation.js';
import { AmendmentService } from './amendment.service.js';
import type {
  DeclarationVersion,
  DeclarationVersionDetail,
  SubmissionResult,
} from './representation.js';
import { SubmissionService } from './submission.service.js';
import { versionNumber } from './versions.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

const ApiDeclarationIdParam = () =>
  ApiParam({ name: 'declarationId', schema: { type: 'string', format: 'uuid' } });

const ETAG_HEADER = {
  ETag: {
    schema: { type: 'string' },
    description: 'The draft version; send it as If-Match on section saves',
  },
};

/** The part of Fastify's reply the routes use. */
interface Reply {
  header(name: string, value: string): unknown;
}

/**
 * Submission, amendments and versions (spec 06). Declarant only, by the `person_id` claim: any
 * other caller, staff included, gets 404 as if the declaration did not exist.
 */
@ApiTags('submission')
@Controller('v1')
export class SubmissionController {
  constructor(
    private readonly submission: SubmissionService,
    private readonly amendments: AmendmentService,
  ) {}

  @Post('declarations/:declarationId/submit')
  @HttpCode(HttpStatus.CREATED)
  @RequireIdempotencyKey()
  @ApiParam({ name: 'declarationId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'submitDeclaration',
    summary: 'Submit the declaration (the legal act)',
    description:
      'Requires a token with the step-up ACR and auth_time within 5 minutes, and an Idempotency-Key (a retry with the same key gets the same answer). One transaction: validate, allocate the reference (first version), write the immutable version and items, mark submitted, file the obligation (late after its due date), record `declaration.submitted.v1` and `obligation.status-changed.v1`. The acknowledgement slip is issued asynchronously afterwards.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Submitted; acknowledgement pending',
    schema: schemaRef('SubmissionResult'),
  })
  @ApiProblemResponse(
    400,
    'Problem code `incomplete` with `blocking`, or the Idempotency-Key header missing (`idempotency-key-missing`)',
    'SubmitProblem',
  )
  @ApiProblemResponse(403, 'Problem code `step-up-required` with `stepUpUrl`', 'SubmitProblem')
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  @ApiProblemResponse(
    409,
    'Problem code `not-a-draft`, `before-statement-date`, `amendment-window-closed` or `obligation-cancelled`; or a request with the same Idempotency-Key still running (`idempotency-key-in-use`)',
    'SubmitProblem',
  )
  submit(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<SubmissionResult> {
    return this.submission.submit(principal, declarationId, idempotencyKey);
  }

  @Post('declarations/:declarationId/amend')
  @HttpCode(HttpStatus.OK)
  @ApiDeclarationIdParam()
  @ApiOperation({
    operationId: 'amendDeclaration',
    summary: 'Reopen a submitted declaration for amendment (until the due date)',
    description:
      "Until the obligation's due date (the due date itself included; Africa/Nairobi by the service's clock). The version in force is copied into editable sections, the declaration is `amending` with `amendingFromVersion`, and `declaration.amendment-started.v1` is recorded. The version stays in force until the amendment is submitted as the next version. An amendment already in progress is answered as it is.",
  })
  @ApiOkResponse({
    description: 'Amending, with sections copied from the version in force',
    headers: ETAG_HEADER,
    schema: schemaRef('Declaration'),
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem code `not-submitted` (never submitted), `amendment-window-closed` (after the due date) or `obligation-cancelled`',
    'SubmitProblem',
  )
  async amend(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<Declaration> {
    const declaration = await this.amendments.amend(principal, declarationId);
    reply.header('ETag', etag(declaration.draftVersion));
    return declaration;
  }

  @Post('declarations/:declarationId/amend/discard')
  @HttpCode(HttpStatus.OK)
  @ApiDeclarationIdParam()
  @ApiOperation({
    operationId: 'discardAmendment',
    summary: 'Discard the amendment in progress; the version in force stays',
    description:
      'The declaration is `submitted` again, its sections as the version in force has them (what the amendment changed, attachments included, is taken back); `declaration.amendment-discarded.v1` is recorded. No version changes. A submitted declaration with no amendment in progress is answered as it is.',
  })
  @ApiOkResponse({
    description: 'Submitted again',
    headers: ETAG_HEADER,
    schema: schemaRef('Declaration'),
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem code `not-submitted`: a draft, discarded with discardDeclaration',
    'SubmitProblem',
  )
  @ApiProblemResponse(
    503,
    'An attachment the amendment unlinked could not be checked with documents (`documents-unavailable`); retry',
  )
  async discardAmendment(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<Declaration> {
    const declaration = await this.amendments.discard(principal, declarationId);
    reply.header('ETag', etag(declaration.draftVersion));
    return declaration;
  }

  @Get('declarations/:declarationId/versions')
  @ApiDeclarationIdParam()
  @ApiOperation({
    operationId: 'listDeclarationVersions',
    summary: 'Submitted versions, newest first',
    description:
      'Every version with its reference, submission time, lateness, hash, supersession and acknowledgement slip; empty before the first submission.',
  })
  @ApiOkResponse({
    description: 'Versions, newest first',
    schema: { type: 'array', items: schemaRef('DeclarationVersion') },
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  versions(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
  ): Promise<DeclarationVersion[]> {
    return this.amendments.versions(principal, declarationId);
  }

  @Get('declarations/:declarationId/versions/:version')
  @ApiDeclarationIdParam()
  @ApiParam({ name: 'version', schema: { type: 'integer', minimum: 1 } })
  @AuditedRead({ action: 'declaration.version.read', resource: 'declaration-version' })
  @ApiOperation({
    operationId: 'getDeclarationVersion',
    summary: 'One immutable version with its document (decrypted for the declarant)',
    description:
      'The version as listed, with the `declaration.v1` document exactly as submitted (the canonical JSON `canonicalSha256` is the hash of), decrypted for the declarant; audited.',
  })
  @ApiOkResponse({ description: 'The version', schema: schemaRef('DeclarationVersionDetail') })
  @ApiProblemResponse(400, 'version is not a positive integer')
  @ApiProblemResponse(404, NOT_VISIBLE)
  version(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Param('version', versionNumber) version: number,
  ): Promise<DeclarationVersionDetail> {
    return this.amendments.version(principal, declarationId, version);
  }
}

/** The draft version as an `ETag`. */
function etag(draftVersion: number): string {
  return `"${String(draftVersion)}"`;
}
