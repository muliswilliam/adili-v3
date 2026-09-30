import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, CurrentPrincipal, type Principal, schemaRef } from '@adili/api-kit';

import { ApiDeclarationIdParam, etag, etagHeader, NOT_VISIBLE, type Reply } from '../http.js';
import { AttachmentsService } from './attachments.service.js';
import type { DeclarationAttachment } from './representation.js';

const ETAG_HEADER = etagHeader(
  'The new draft version; send it as If-Match on the next section save',
);

/**
 * Attachments on a draft's statement items (spec 05). Declarant only, by the `person_id` claim;
 * any other caller gets 404. Each link and unlink changes the section, so it bumps the draft
 * version and returns it as `ETag`.
 */
@ApiTags('declarations')
@Controller('v1/declarations/:declarationId/attachments')
@ApiDeclarationIdParam()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @ApiOperation({
    operationId: 'linkDeclarationAttachment',
    summary: 'Link a clean upload (purpose declaration-attachment) to an item',
    description:
      "The upload must be the Commission's, clean, and uploaded with purpose declaration-attachment. Its name, SHA-256 and size are kept, and a reference is added to the item inside the encrypted statement. Records `declaration.attachment-linked.v1`.",
  })
  @ApiBody({ required: true, schema: schemaRef('AttachmentLink') })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Linked; new draft version in ETag',
    headers: ETAG_HEADER,
    schema: schemaRef('DeclarationAttachment'),
  })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(404, `${NOT_VISIBLE}, or the statement has no such item`)
  @ApiProblemResponse(
    409,
    "Upload is unknown or another Commission's (`upload-not-found`), not clean (`upload-not-clean`), has the wrong purpose (`upload-wrong-purpose`) or is attached already (`upload-already-linked`); or not a draft (`declaration-not-draft`), or the statement is archived (`section-archived`)",
  )
  @ApiProblemResponse(503, 'The upload could not be checked (`documents-unavailable`); retry')
  async link(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<DeclarationAttachment> {
    const { attachment, draftVersion } = await this.attachments.link(
      principal,
      declarationId,
      body,
    );
    reply.header('ETag', etag(draftVersion));
    return attachment;
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'attachmentId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'unlinkDeclarationAttachment',
    summary: 'Remove an attachment from its item',
    description:
      "Removes the attachment and the item's reference to it. The file is left to the documents orphan sweep. Records `declaration.attachment-unlinked.v1`.",
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Unlinked; new draft version in ETag',
    headers: ETAG_HEADER,
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Not a draft (`declaration-not-draft`)')
  async unlink(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<void> {
    const { draftVersion } = await this.attachments.unlink(principal, declarationId, attachmentId);
    reply.header('ETag', etag(draftVersion));
  }
}
