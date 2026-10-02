import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
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
  ActingTenant,
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  CurrentReadAudit,
  InternalApi,
  type Principal,
  type ReadAudit,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { DOCUMENTS_INTERNAL_SCOPE } from '@adili/roles';
import { z } from 'zod';

import { type Downloader, IssuanceService } from './issuance.service.js';
import {
  type DocumentDownload,
  type IssueDocumentRequest,
  issueDocumentRequest,
  type IssuedDocument,
  type SupersedeDocumentBody,
  supersedeDocumentBody,
} from './representation.js';

const documentId = new ZodValidationPipe(z.uuid());
const ApiDocumentIdParam = () =>
  ApiParam({ name: 'documentId', schema: { type: 'string', format: 'uuid' } });
const NOT_VISIBLE = 'Not found, or not visible to the caller';

/** The part of Fastify's reply the routes use. */
interface Reply {
  status(code: number): unknown;
}

/**
 * Issued documents for their subject person (the declarant, the applicant or the law-enforcement
 * officer they were issued to) and the issuing Commission's staff the issuer named as additional
 * downloaders (the access officer handing over an in-person certified copy): metadata and a
 * short-lived download within the document's download window. Anyone else gets 404, as if the
 * document did not exist.
 */
@ApiTags('documents')
@Controller('v1/documents')
export class DocumentsController {
  constructor(private readonly issuance: IssuanceService) {}

  @Get(':documentId')
  @ApiDocumentIdParam()
  @ApiOperation({
    operationId: 'getDocument',
    summary: 'Metadata of an issued document (owner)',
    description:
      "The person the document is about, or staff of the issuing Commission named among the document's additional downloaders; anyone else gets 404.",
  })
  @ApiOkResponse({ description: 'Metadata', schema: schemaRef('IssuedDocument') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('documentId', documentId) id: string,
  ): Promise<IssuedDocument> {
    return this.issuance.getOwned(downloaderOf(principal), id);
  }

  @Get(':documentId/download')
  @AuditedRead({ action: 'document.downloaded', resource: 'issued-document' })
  @ApiDocumentIdParam()
  @ApiOperation({
    operationId: 'getDocumentDownload',
    summary: 'Short-lived presigned download of an issued PDF (owner)',
    description:
      "The document's subject person (the `person_id` of their token), or an access officer of the issuing Commission named among the document's additional downloaders (their token's `sub`, tenant and role); anyone else gets 404. A document with a download window (an access package) is refused with 410 once it ends. Every download link handed out is audited under the issuing Commission and recorded as `document.downloaded.v1`, which the access register reads.",
  })
  @ApiOkResponse({
    description: 'Download URL valid for five minutes',
    schema: schemaRef('DocumentDownload'),
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(410, 'Problem type `download-window-closed`: the download window has ended')
  async download(
    @CurrentPrincipal() principal: Principal,
    @Param('documentId', documentId) id: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<DocumentDownload> {
    const { download, document, downloaded } = await this.issuance.download(
      downloaderOf(principal),
      id,
    );
    audit.resource({ tenant: document.tenant, subjectPersonId: document.subjectPersonId });
    // The download the access register reads and its audit event: both recorded, or neither.
    audit.alongside(downloaded);
    return download;
  }
}

function downloaderOf(principal: Principal): Downloader {
  return {
    personId: principal.personId,
    subject: principal.subject,
    tenant: principal.tenant,
    roles: principal.roles,
  };
}

/** Internal: not routed by the public entrypoint. Callers are services acting for a tenant. */
@ApiTags('internal')
@Controller('internal/v1/documents')
@InternalApi(DOCUMENTS_INTERNAL_SCOPE)
export class InternalDocumentsController {
  constructor(private readonly issuance: IssuanceService) {}

  @Post('issue')
  @AcceptIdempotencyKey()
  @ApiOperation({
    operationId: 'issueDocument',
    summary: 'Render, sign and register a document (services)',
    description:
      "Service tokens with scope documents:internal, issuing for the tenant in X-Acting-Tenant. Renders the type's versioned template to PDF through Gotenberg with the verification code and QR in the footer of every page and the watermark, when given, across every page, PAdES-signs it with the documents signing certificate, stores its SHA-256 in an Ed25519-signed verification record, stores the PDF and emits `document.issued.v1`. The disclosure level and public payload are the template's. `downloadWindowDays` limits the subject person's downloads to that many days from issue. An access-package and an access-nil-letter require a watermark, a download window and a subject person; a certified-copy a subject person. One document per type and subject: issuing again returns it with 200.",
  })
  @ApiBody({ required: true, schema: schemaRef('IssueDocument') })
  @ApiCreatedResponse({ description: 'Issued', schema: schemaRef('IssuedDocument') })
  @ApiOkResponse({
    description: 'Issued for this subject already; the document issued',
    schema: schemaRef('IssuedDocument'),
  })
  @ApiProblemResponse(
    400,
    "Request failed validation, the payload is not the template's, or the request lacks what the type requires",
  )
  @ApiProblemResponse(
    502,
    'Problem type `renderer-unavailable`, `signer-unavailable` or `storage-unavailable`: nothing was issued; retry',
  )
  async issue(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Body(new ZodValidationPipe(issueDocumentRequest)) body: IssueDocumentRequest,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<IssuedDocument> {
    const { document, created } = await this.issuance.issue({
      tenant,
      actor: principal.subject,
      ...body,
    });
    reply.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return document;
  }

  @Post(':documentId/supersede')
  @HttpCode(HttpStatus.OK)
  @AcceptIdempotencyKey()
  @ApiDocumentIdParam()
  @ApiOperation({
    operationId: 'supersedeDocument',
    summary: 'Mark a document superseded by a newer one (services)',
    description:
      'Service tokens with scope documents:internal, acting for the tenant in X-Acting-Tenant. Sets the status to superseded and supersededBy to the newer document, re-signs the verification record and emits `document.superseded.v1`.',
  })
  @ApiBody({ required: true, schema: schemaRef('SupersedeDocument') })
  @ApiOkResponse({ description: 'Superseded', schema: schemaRef('IssuedDocument') })
  @ApiProblemResponse(404, "Not found, or not the acting tenant's document")
  @ApiProblemResponse(
    409,
    'Problem type `document-not-valid` (superseded or revoked already) or `superseding-document-invalid` (the newer document is not a valid document of the same type)',
  )
  @ApiProblemResponse(502, 'Problem type `signer-unavailable`: nothing changed; retry')
  supersede(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('documentId', documentId) id: string,
    @Body(new ZodValidationPipe(supersedeDocumentBody)) body: SupersedeDocumentBody,
  ): Promise<IssuedDocument> {
    return this.issuance.supersede({
      tenant,
      actor: principal.subject,
      documentId: id,
      supersededBy: body.supersededBy,
    });
  }
}
