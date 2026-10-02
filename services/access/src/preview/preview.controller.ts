import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  CurrentReadAudit,
  type Principal,
  ReadAudit,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { OFFICER_ROUTE_ROLES } from '../access.js';
import { type Scope, scopeSchema } from '../scope.js';
import { PreviewService } from './preview.service.js';
import type { ScopePreview } from './representation.js';

const REQUEST_ID = { name: 'requestId', schema: { type: 'string', format: 'uuid' } } as const;

const WHO =
  "The Commission's access officer, and its supervisor (reading); another Commission's request, and EACC, get 404.";

const COUNTS =
  'Per year of the scope, the declarations of the declarant at the Commission and, per section and included household member kind, how many entries and persons a grant would disclose, with the clarifications when the scope includes them: counts only, never content. `empty` when the scope holds nothing, so a grant would issue the nil letter (no declarations held within the granted scope) instead of an access package. Audited (`audit.read.v1`) with the legal basis, the reference and the caller as recipient; declarations and review audit their counts alike.';

const NOT_THE_COMMISSIONS =
  "No such request at the caller's Commission (another Commission's, EACC's or anyone else's view)";

/**
 * The scope preview (spec 10, decision 1) of a Form K or law enforcement request: what the
 * requested scope, or a narrower one being weighed, holds of the declarant's declarations, for
 * the access officer before deciding. Reads: the supervisor may view them too.
 */
@ApiTags('officer')
@Controller()
export class PreviewController {
  constructor(private readonly previews: PreviewService) {}

  @Get('v1/access/requests/:requestId/preview')
  @Roles(...OFFICER_ROUTE_ROLES)
  @AuditedRead({ action: 'access.scope.previewed', resource: 'access-request' })
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'getAccessRequestScopePreview',
    summary: 'What the requested scope holds, in counts (no content; audited)',
    description: `${WHO} Once the officer named is identified, until the decision. ${COUNTS}`,
  })
  @ApiOkResponse({ description: 'Preview', schema: schemaRef('ScopePreview') })
  @ApiProblemResponse(400, 'requestId is not a UUID')
  @ApiProblemResponse(403, 'Not an access officer or supervisor')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(
    409,
    'Problem code `not-under-decision` (the officer named is not identified yet), `request-decided` or `request-closed`',
  )
  @ApiProblemResponse(503, 'Declarations or review cannot be reached')
  formK(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<ScopePreview> {
    return this.previews.formK(principal, requestId, null, audit);
  }

  @Post('v1/access/requests/:requestId/preview')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICER_ROUTE_ROLES)
  @AuditedRead({ action: 'access.scope.previewed', resource: 'access-request' })
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'previewAccessRequestScope',
    summary: 'What a proposed scope (the requested one, or narrower) holds, in counts (audited)',
    description: `${WHO} The scope the officer is weighing for a partial grant: within the requested one (else 400 \`scope-exceeds-request\`). A read: no Idempotency-Key. ${COUNTS}`,
  })
  @ApiBody({ required: true, schema: schemaRef('Scope') })
  @ApiOkResponse({ description: 'Preview', schema: schemaRef('ScopePreview') })
  @ApiProblemResponse(
    400,
    'requestId is not a UUID, the scope failed validation, or problem code `scope-exceeds-request`',
  )
  @ApiProblemResponse(403, 'Not an access officer or supervisor')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(
    409,
    'Problem code `not-under-decision` (the officer named is not identified yet), `request-decided` or `request-closed`',
  )
  @ApiProblemResponse(503, 'Declarations or review cannot be reached')
  formKScope(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(scopeSchema)) scope: Scope,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<ScopePreview> {
    return this.previews.formK(principal, requestId, scope, audit);
  }

  @Get('v1/lea/requests/:requestId/preview')
  @Roles(...OFFICER_ROUTE_ROLES)
  @AuditedRead({ action: 'access.scope.previewed', resource: 'lea-request' })
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'getLeaRequestScopePreview',
    summary: 'What the requested scope of a law enforcement request holds, in counts (audited)',
    description: `${WHO} Once verified (the officer sought identified), until the decision; never the agency's officer. ${COUNTS}`,
  })
  @ApiOkResponse({ description: 'Preview', schema: schemaRef('ScopePreview') })
  @ApiProblemResponse(400, 'requestId is not a UUID')
  @ApiProblemResponse(403, 'Not an access officer or supervisor')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(
    409,
    'Problem code `not-under-decision` (not verified yet), `request-decided` or `request-closed`',
  )
  @ApiProblemResponse(503, 'Declarations cannot be reached')
  lea(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<ScopePreview> {
    return this.previews.lea(principal, requestId, null, audit);
  }

  @Post('v1/lea/requests/:requestId/preview')
  @HttpCode(HttpStatus.OK)
  @Roles(...OFFICER_ROUTE_ROLES)
  @AuditedRead({ action: 'access.scope.previewed', resource: 'lea-request' })
  @ApiParam(REQUEST_ID)
  @ApiOperation({
    operationId: 'previewLeaRequestScope',
    summary: 'What a proposed scope of a law enforcement request holds, in counts (audited)',
    description: `${WHO} Within the requested scope (else 400 \`scope-exceeds-request\`; clarifications are never in one). A read: no Idempotency-Key. ${COUNTS}`,
  })
  @ApiBody({ required: true, schema: schemaRef('Scope') })
  @ApiOkResponse({ description: 'Preview', schema: schemaRef('ScopePreview') })
  @ApiProblemResponse(
    400,
    'requestId is not a UUID, the scope failed validation, or problem code `scope-exceeds-request`',
  )
  @ApiProblemResponse(403, 'Not an access officer or supervisor')
  @ApiProblemResponse(404, NOT_THE_COMMISSIONS)
  @ApiProblemResponse(
    409,
    'Problem code `not-under-decision` (not verified yet), `request-decided` or `request-closed`',
  )
  @ApiProblemResponse(503, 'Declarations cannot be reached')
  leaScope(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ZodValidationPipe(z.uuid())) requestId: string,
    @Body(new ZodValidationPipe(scopeSchema)) scope: Scope,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<ScopePreview> {
    return this.previews.lea(principal, requestId, scope, audit);
  }
}
