import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
} from '@adili/api-kit';
import { DECLARATIONS_INTERNAL_SCOPE } from '@adili/roles';

import { ApiVersionParams, NOT_VISIBLE } from '../http.js';
import type { Acknowledgement } from '../declaration/representation.js';
import { versionNumber } from '../declaration/versions.js';
import { AcknowledgementService } from './acknowledgement.service.js';
import type { AcknowledgementPayload } from './representation.js';

/**
 * A version's acknowledgement slip (spec 06). Declarant only, by the `person_id` claim: any other
 * caller, staff included, gets 404 as if the version did not exist.
 */
@ApiTags('submission')
@Controller('v1/declarations/:declarationId/versions/:version/acknowledgement')
export class AcknowledgementController {
  constructor(private readonly acknowledgements: AcknowledgementService) {}

  @Get()
  @ApiVersionParams()
  @ApiOperation({
    operationId: 'getAcknowledgement',
    summary: 'Acknowledgement slip status and download link for a version',
    description:
      'The declarant only. `pending` while the documents service prepares the slip (seconds after submission), `issued` with the document and its verification code once set on the version, `failed` when it has not come within a minute of the submission or of the last reissue (the stored acknowledgement stays pending): it may be asked for again. The slip downloads from the documents service (`getDocumentDownload` with `documentId`).',
  })
  @ApiOkResponse({ description: 'Status', schema: schemaRef('Acknowledgement') })
  @ApiProblemResponse(400, 'version is not a positive integer')
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Param('version', versionNumber) version: number,
  ): Promise<Acknowledgement> {
    return this.acknowledgements.get(principal, declarationId, version);
  }

  @Post('reissue')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiVersionParams()
  @ApiOperation({
    operationId: 'reissueAcknowledgement',
    summary: 'Ask for the slip again when issuance failed',
    description:
      'The declarant only. Accepted (202) once the slip has not come within a minute of the submission, or of the last reissue: the acknowledgement is `failed` (still `pending` as stored); records `declaration.acknowledgement-requested.v1`, the documents service issues the slip (or announces the one it issued), and the acknowledgement is `pending` again for a minute. 409 `acknowledgement-issued` once issued; 409 `acknowledgement-in-progress` within a minute of the submission; 429 `resend-cooldown` with `retryAfterSeconds` within a minute of the last reissue.',
  })
  @ApiResponse({ status: HttpStatus.ACCEPTED, description: 'Reissue requested' })
  @ApiProblemResponse(400, 'version is not a positive integer')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Problem code `acknowledgement-issued` (the slip is issued) or `acknowledgement-in-progress` (within a minute of the submission)',
  )
  @ApiProblemResponse(
    429,
    'Problem code `resend-cooldown` with `retryAfterSeconds`: within a minute of the last reissue',
  )
  reissue(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Param('version', versionNumber) version: number,
  ): Promise<void> {
    return this.acknowledgements.reissue(principal, declarationId, version);
  }
}

/** Internal: not routed by the public entrypoint. Callers are services acting for a Commission. */
@ApiTags('internal')
@Controller('internal/v1/declarations/:declarationId/versions/:version')
@InternalApi(DECLARATIONS_INTERNAL_SCOPE)
export class InternalAcknowledgementController {
  constructor(private readonly acknowledgements: AcknowledgementService) {}

  @Get('acknowledgement-payload')
  @AuditedRead({
    action: 'declaration.acknowledgement-payload.pulled',
    resource: 'declaration-version',
  })
  @ApiVersionParams()
  @ApiOperation({
    operationId: 'internalGetAcknowledgementPayload',
    summary: 'Fields the acknowledgement slip needs (documents service)',
    description:
      'Service tokens with scope declarations:internal, acting for the Commission in X-Acting-Tenant; audited. What the slip prints of the version (its `acknowledgement-slip` v1 payload) and the declarant it is issued for, nothing more. Pulled after `declaration.submitted.v1` or `declaration.acknowledgement-requested.v1`.',
  })
  @ApiOkResponse({ description: 'Payload', schema: schemaRef('AcknowledgementPayload') })
  @ApiProblemResponse(404, "No such version of the acting tenant's declarations")
  async payload(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('declarationId') declarationId: string,
    @Param('version', versionNumber) version: number,
    @CurrentReadAudit() audit: ReadAudit,
  ): Promise<AcknowledgementPayload> {
    const payload = await this.acknowledgements.payload(
      tenant,
      principal.subject,
      declarationId,
      version,
    );
    audit.resource({ tenant, subjectPersonId: payload.declarantPersonId });
    return payload;
  }
}
