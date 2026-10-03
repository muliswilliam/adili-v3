import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  schemaRef,
} from '@adili/api-kit';

import { ApiDeclarationIdParam, etag, etagHeader, NOT_VISIBLE, type Reply } from '../http.js';
import { DraftsService } from './drafts.service.js';
import type {
  Declaration,
  DeclarationListItem,
  DeclarationSummary,
  SectionEnvelope,
  SectionSaveResult,
} from './representation.js';

const ApiSectionKeyParam = () => ApiParam({ name: 'sectionKey', schema: schemaRef('SectionKey') });

/**
 * Declaration drafts (spec 05). Declarant only, by the `person_id` claim: any other caller gets
 * 404 on every route, as if the declaration did not exist.
 */
@ApiTags('declarations')
@Controller('v1')
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Post('obligations/:id/declaration')
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'startDeclaration',
    summary: "Start (or return the existing) draft declaration for the declarant's obligation",
    description:
      'Type, statement date and income period are derived from the obligation; bio is pre-filled from the roster record. Declarant only.',
  })
  @ApiOkResponse({ description: 'Existing draft', schema: schemaRef('Declaration') })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Draft created with pre-filled bio',
    schema: schemaRef('Declaration'),
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Obligation is filed or cancelled (`obligation-closed`)')
  @ApiProblemResponse(503, 'The roster record could not be read (`directory-unavailable`)')
  async start(
    @CurrentPrincipal() principal: Principal,
    @Param('id') obligationId: string,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<Declaration> {
    const { created, declaration } = await this.drafts.start(principal, obligationId);
    reply.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    reply.header('ETag', etag(declaration.draftVersion));
    return declaration;
  }

  @Get('declarations/:declarationId')
  @ApiDeclarationIdParam()
  @ApiOperation({
    operationId: 'getDeclaration',
    summary: 'Draft header and section completeness (no contents)',
  })
  @ApiOkResponse({
    description: 'The draft',
    headers: etagHeader(),
    schema: schemaRef('Declaration'),
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<Declaration> {
    const declaration = await this.drafts.get(principal, declarationId);
    reply.header('ETag', etag(declaration.draftVersion));
    return declaration;
  }

  @Get('me/declarations')
  @ApiOperation({
    operationId: 'getMyDeclarations',
    summary: "The signed-in declarant's declarations: drafts, submitted and being amended",
    description:
      'Live declarations across Commissions, last updated first, with the share of live sections complete and, once submitted, the reference, the version in force (submitted at, late, acknowledgement slip) and whether Amend is open today (until the due date, Africa/Nairobi), so the list renders without a call per row. Authorised by the person_id claim; staff tokens without it get 404.',
  })
  @ApiOkResponse({
    description: 'Declarations, last updated first',
    schema: { type: 'array', items: schemaRef('DeclarationListItem') },
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  mine(@CurrentPrincipal() principal: Principal): Promise<DeclarationListItem[]> {
    return this.drafts.mine(principal);
  }

  @Delete('declarations/:declarationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeclarationIdParam()
  @ApiOperation({
    operationId: 'discardDeclaration',
    summary: 'Discard the draft',
    description:
      'Deletes the sections and attachments (records `declaration.attachment-unlinked.v1` for each, then `declaration.draft-discarded.v1`). The obligation is untouched: starting again makes a fresh draft.',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Discarded' })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Not a draft (`declaration-not-draft`)')
  async discard(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
  ): Promise<void> {
    await this.drafts.discard(principal, declarationId);
  }

  @Get('declarations/:declarationId/summary')
  @ApiDeclarationIdParam()
  @AuditedRead({ action: 'declaration.summary.read', resource: 'declaration' })
  @ApiOperation({
    operationId: 'getDeclarationSummary',
    summary:
      'The assembled declaration validated against declaration.v1, with what blocks submission',
    description:
      'Assembled from the live sections (archived statements left out), paragraph 9 material changes composed from the items. `canSubmit` is false in this slice.',
  })
  @ApiOkResponse({ description: 'Summary', schema: schemaRef('DeclarationSummary') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  summary(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
  ): Promise<DeclarationSummary> {
    return this.drafts.summary(principal, declarationId);
  }

  @Get('declarations/:declarationId/sections/:sectionKey')
  @ApiDeclarationIdParam()
  @ApiSectionKeyParam()
  @AuditedRead({ action: 'declaration.section.read', resource: 'declaration-section' })
  @ApiOperation({
    operationId: 'getDeclarationSection',
    summary: "One section's contents (decrypted for the owning declarant)",
  })
  @ApiOkResponse({
    description: 'Section contents',
    headers: etagHeader(),
    schema: schemaRef('SectionEnvelope'),
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  async getSection(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Param('sectionKey') sectionKey: string,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<SectionEnvelope> {
    const section = await this.drafts.getSection(principal, declarationId, sectionKey);
    reply.header('ETag', etag(section.draftVersion));
    return section;
  }

  @Put('declarations/:declarationId/sections/:sectionKey')
  @ApiDeclarationIdParam()
  @ApiSectionKeyParam()
  @ApiOperation({
    operationId: 'saveDeclarationSection',
    summary: 'Save a section (autosave); requires If-Match with the current draft version',
    description:
      "The whole section is sent. Missing fields are saved and reported as completeness issues; a malformed body is refused. Locked bio fields may be left out. Each item's `source` is the service's (set by `acceptSuggestion`): kept as stored whatever is sent, none on an item that had none, and without `verificationResultId` once the item changes where the registry spoke.",
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'The draft version read (its ETag)',
    schema: { type: 'string' },
  })
  @ApiBody({ required: true, schema: schemaRef('SectionContents') })
  @ApiOkResponse({
    description: 'Saved; new version in ETag',
    headers: etagHeader(),
    schema: schemaRef('SectionSaveResult'),
  })
  @ApiProblemResponse(
    400,
    'Validation failed, or a locked field was changed (`identity-locked-field`), or a nil flag conflicts with items (`nil-conflicts-with-items`)',
  )
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Not a draft (`declaration-not-draft`), or the statement is archived (`section-archived`)',
  )
  @ApiProblemResponse(
    412,
    'If-Match does not match the current draft version (`draft-version-mismatch`); reload',
  )
  @ApiProblemResponse(428, 'If-Match header missing (`if-match-required`)')
  async saveSection(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Param('sectionKey') sectionKey: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<SectionSaveResult> {
    const result = await this.drafts.saveSection(
      principal,
      declarationId,
      sectionKey,
      ifMatch,
      body,
    );
    reply.header('ETag', etag(result.draftVersion));
    return result;
  }
}
