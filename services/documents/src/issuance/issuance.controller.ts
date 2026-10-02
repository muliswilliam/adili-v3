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

import { IssuanceService } from './issuance.service.js';
import {
  type DocumentDownload,
  type IssueDocumentBody,
  issueDocumentBody,
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
 * Issued documents for the person they are about (the declarant): metadata and a short-lived
 * download. Anyone else gets 404, as if the document did not exist. Staff read a document
 * through the service that owns the record it is about (a reviewer a clarification letter
 * through the review service, which checks the case), which asks the internal download below.
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
    description: 'The person the document is about only; anyone else gets 404.',
  })
  @ApiOkResponse({ description: 'Metadata', schema: schemaRef('IssuedDocument') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('documentId', documentId) id: string,
  ): Promise<IssuedDocument> {
    return this.issuance.getOwned(principal.personId, principal.subject, id);
  }

  @Get(':documentId/download')
  @AuditedRead({ action: 'document.downloaded', resource: 'issued-document' })
  @ApiDocumentIdParam()
  @ApiOperation({
    operationId: 'getDocumentDownload',
    summary: 'Short-lived presigned download of an issued PDF (owner)',
    description:
      'The person the document is about only; anyone else gets 404. Every download link handed out is audited under the issuing Commission.',
  })
  @ApiOkResponse({
    description: 'Download URL valid for five minutes',
    schema: schemaRef('DocumentDownload'),
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  async download(
    @CurrentPrincipal() principal: Principal,
    @Param('documentId', documentId) id: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<DocumentDownload> {
    const { download, document } = await this.issuance.download(
      principal.personId,
      principal.subject,
      id,
    );
    audit.resource({ tenant: document.tenant, subjectPersonId: document.subjectPersonId });
    return download;
  }
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
      "Service tokens with scope documents:internal, issuing for the tenant in X-Acting-Tenant. Renders the type's versioned template to PDF through Gotenberg with the verification code and QR in the footer of every page, PAdES-signs it with the documents signing certificate, stores its SHA-256 in an Ed25519-signed verification record, stores the PDF and emits `document.issued.v1`. The disclosure level and public payload are the template's. A clarification letter names its clarification; its fields are pulled from the review service (internalGetClarificationLetterPayload) for the same tenant. One document per type and subject: issuing again returns it with 200.",
  })
  @ApiBody({ required: true, schema: schemaRef('IssueDocument') })
  @ApiCreatedResponse({ description: 'Issued', schema: schemaRef('IssuedDocument') })
  @ApiOkResponse({
    description: 'Issued for this subject already; the document issued',
    schema: schemaRef('IssuedDocument'),
  })
  @ApiProblemResponse(
    400,
    "Request failed validation, the payload (or the one pulled) is not the template's, or the review service holds no issued clarification with the id for the tenant",
  )
  @ApiProblemResponse(
    502,
    'Problem type `renderer-unavailable`, `signer-unavailable`, `storage-unavailable` or `review-unavailable`: nothing was issued; retry',
  )
  async issue(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Body(new ZodValidationPipe(issueDocumentBody)) body: IssueDocumentBody,
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

  @Get(':documentId/download')
  @AuditedRead({ action: 'document.downloaded', resource: 'issued-document' })
  @ApiDocumentIdParam()
  @ApiOperation({
    operationId: 'internalGetDocumentDownload',
    summary: 'Short-lived presigned download of an issued PDF (services)',
    description:
      "Service tokens with scope documents:internal, acting for the tenant in X-Acting-Tenant: the issuing tenant's documents only. The service owning the record a document is about asks it for its staff (the review service for a reviewer opening a clarification letter), after checking the staff member may see that record; it audits that read with the staff member and the person. This read is audited too, under the issuing tenant and naming the person the document is about.",
  })
  @ApiOkResponse({
    description: 'Download URL valid for five minutes',
    schema: schemaRef('DocumentDownload'),
  })
  @ApiProblemResponse(404, "Not found, or not the acting tenant's document")
  async download(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('documentId', documentId) id: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<DocumentDownload> {
    const { download, document } = await this.issuance.downloadForTenant(
      tenant,
      principal.subject,
      id,
    );
    audit.resource({ tenant: document.tenant, subjectPersonId: document.subjectPersonId });
    return download;
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
