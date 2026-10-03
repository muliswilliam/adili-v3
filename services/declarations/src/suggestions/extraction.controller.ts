import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
} from '@adili/api-kit';

import { ApiDeclarationIdParam, NOT_VISIBLE } from '../http.js';
import { ExtractionService } from './extraction.service.js';
import type { SuggestionSet } from './representation.js';

/**
 * "Read into the form" (spec 05b S6): a document attached to an item of the draft read by the
 * ai-gateway into a suggestion. Declarant only, by the `person_id` claim; any other caller gets
 * 404. The answer can hold what the document says, so it is an audited read (ADR-008), as the
 * suggestions list is.
 */
@ApiTags('suggestions')
@Controller('v1/declarations/:declarationId/attachments/:attachmentId/extract')
@ApiDeclarationIdParam()
@ApiParam({ name: 'attachmentId', schema: { type: 'string', format: 'uuid' } })
export class ExtractionController {
  constructor(private readonly extractions: ExtractionService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireIdempotencyKey()
  @AuditedRead({ action: 'declaration.suggestions.read', resource: 'declaration' })
  @ApiOperation({
    operationId: 'extractAttachment',
    summary:
      'Read a clean attachment into suggested fields through the ai-gateway (declarant); policy-gated',
    description:
      "The document is read into the item it is attached to: the item's statement list (`assets`, `income` or `liabilities`) and type. Documents hands out a short-lived link to the clean file (audited as read for the declarant), and the ai-gateway's `extract-document` task reads it with data class `highly-confidential`, the declaration as subject, if the Commission's AI policy lets documents go to a provider. Answers the `document` set: `pending` while it is read (poll `listSuggestions` until it is not), `ready` with one suggestion (fields by declaration.v1 path within the item, each with its confidence and page in `sourceRef`, matched to the attached item), `not-enabled` when the policy keeps documents from AI, or `failed` with its `reason` (a file a reading does not take, such as HEIC, fails at once without being sent). Asking again for the same attachment, kind and item type while it is pending, or offered and not decided on, answers that reading (pulling it from the gateway if it has ended); otherwise it is read again, and a reading that becomes `ready` supersedes the `new` suggestions of the attachment's earlier ones. Records `declaration.extraction-requested.v1` (identifiers, the job) and, once read, `declaration.suggestions-ready.v1`.",
  })
  @ApiBody({ required: false, schema: schemaRef('ExtractAttachmentRequest') })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Reading requested; the `document` suggestion set',
    schema: schemaRef('SuggestionSet'),
  })
  @ApiProblemResponse(
    400,
    'Validation failed (an unknown document kind or language, or the attached item has no type yet), or the Idempotency-Key header missing',
  )
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Not a draft (`declaration-not-draft`), the file is no longer clean (`upload-not-clean`), or a request with the same Idempotency-Key still running',
  )
  @ApiProblemResponse(
    503,
    'Documents (`documents-unavailable`) or the ai-gateway (`ai-gateway-unavailable`) could not take it now; no reading was recorded',
  )
  extract(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: unknown,
  ): Promise<SuggestionSet> {
    return this.extractions.request(principal, declarationId, attachmentId, body);
  }
}
