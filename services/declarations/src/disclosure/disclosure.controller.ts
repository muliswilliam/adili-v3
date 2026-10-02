import {
  Body,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
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
import { DECLARATIONS_INTERNAL_SCOPE } from '@adili/roles';
import { z } from 'zod';

import { versionNumber } from '../declaration/versions.js';
import { ApiVersionParams } from '../http.js';
import { DisclosureService } from './disclosure.service.js';
import {
  type DisclosureDocument,
  type DisclosureRequest,
  disclosureRequestSchema,
  type FullDocumentRequest,
  fullDocumentRequestSchema,
  type FullVersionDocument,
  SELF_ACCESS,
} from './representation.js';

/**
 * The `X-Acting-Subject` header, validated by the pipe given: required here, as a disclosure
 * always names whom the service acts for.
 */
const ActingSubject = createParamDecorator(
  (_: unknown, context: ExecutionContext): unknown =>
    context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers[
      'x-acting-subject'
    ],
);

/**
 * Internal: not routed by the public entrypoint. The access service (spec 10) asks here for what
 * an access grant discloses and for a declarant's certified copy; nothing else in the platform
 * decrypts declarations for a third party. Every read is audited (ADR-008) with its legal basis,
 * the reference that authorises it and its recipient, for the access register and the
 * declarant's "who accessed my declaration".
 */
@ApiTags('internal')
@Controller('internal/v1/declarations')
@InternalApi(DECLARATIONS_INTERNAL_SCOPE)
export class InternalDisclosureController {
  constructor(private readonly disclosures: DisclosureService) {}

  @Post('disclosures')
  @HttpCode(HttpStatus.OK)
  @AuditedRead({ action: 'declaration.disclosed', resource: 'declaration' })
  @ApiHeader({
    name: 'X-Acting-Subject',
    required: true,
    description: 'The access officer who decided the grant; recorded in the audit event',
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiOperation({
    operationId: 'internalRenderDisclosure',
    summary:
      "Render the scoped disclosure of a person's submitted declarations for a grant (audited)",
    description:
      "Service tokens with scope declarations:internal, acting for the Commission in X-Acting-Tenant (the access service). For each granted year, the version in force of each of the person's declarations at the Commission, decrypted and cut to the granted household members and sections (`disclosure.v1`); nothing outside the scope is returned. Audited (`audit.read.v1`, action `declaration.disclosed`) with the legal basis, the grant reference and the recipient. A granted year with no version has no entry; 404 when there is none in any granted year, or the person is not the Commission's declarant.",
  })
  @ApiBody({ required: true, schema: schemaRef('DisclosureRequest') })
  @ApiOkResponse({ description: 'The disclosure', schema: schemaRef('DisclosureDocument') })
  @ApiProblemResponse(
    400,
    'Invalid scope, a legal basis that does not go with the grant reference, or no X-Acting-Subject',
  )
  @ApiProblemResponse(
    404,
    "No version of the person's declarations at the acting Commission in the granted years",
  )
  async render(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @ActingSubject(new ZodValidationPipe(z.string().min(1).max(255))) _actingSubject: string,
    @Body(new ZodValidationPipe(disclosureRequestSchema)) request: DisclosureRequest,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<DisclosureDocument> {
    const disclosure = await this.disclosures.render(tenant, principal.subject, request);
    audit.resource({ tenant, subjectPersonId: request.personId });
    audit.disclosure({
      basis: request.legalBasis,
      reference: request.grantReference,
      recipient: request.recipientSubject,
    });
    return disclosure;
  }

  @Post(':declarationId/versions/:version/full-document')
  @HttpCode(HttpStatus.OK)
  @AuditedRead({ action: 'declaration.full-document.pulled', resource: 'declaration-version' })
  @ApiVersionParams()
  @ApiHeader({
    name: 'X-Acting-Subject',
    required: true,
    description:
      'Who asked for the certified copy: the declarant online, or the access officer recording their written application; recorded in the audit event as the actor',
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiOperation({
    operationId: 'internalGetFullDocumentForCertifiedCopy',
    summary:
      "The full immutable document of a version for the declarant's certified copy (audited as self-access)",
    description:
      "Service tokens with scope declarations:internal, acting for the Commission in X-Acting-Tenant (the access service). Any submitted version of the declarant `personId`, decrypted in full with what the certified copy prints of it. A read, posted so that the recipient, possibly a representative's name, stays out of the URL. Audited (`audit.read.v1`, action `declaration.full-document.pulled`) as self-access (Administrative Mechanism 32): X-Acting-Subject is who asked, `recipient` whom the copy is handed to (the declarant, or their representative).",
  })
  @ApiBody({ required: true, schema: schemaRef('FullDocumentRequest') })
  @ApiOkResponse({ description: 'The version in full', schema: schemaRef('FullVersionDocument') })
  @ApiProblemResponse(
    400,
    'version is not a positive integer, the body failed validation, or no X-Acting-Subject',
  )
  @ApiProblemResponse(404, "No such version of the person's declarations at the acting Commission")
  async fullDocument(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @ActingSubject(new ZodValidationPipe(z.string().min(1).max(255))) _actingSubject: string,
    @Param('declarationId') declarationId: string,
    @Param('version', versionNumber) version: number,
    @Body(new ZodValidationPipe(fullDocumentRequestSchema)) request: FullDocumentRequest,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<FullVersionDocument> {
    const full = await this.disclosures.fullDocument(tenant, principal.subject, {
      declarationId,
      version,
      personId: request.personId,
    });
    audit.resource({ tenant, subjectPersonId: request.personId });
    audit.disclosure({ basis: SELF_ACCESS, reference: null, recipient: request.recipient });
    return full;
  }
}
