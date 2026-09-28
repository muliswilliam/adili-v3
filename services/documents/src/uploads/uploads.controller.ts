import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  AuditedRead,
  CurrentPrincipal,
  InternalApi,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { DOCUMENTS_INTERNAL_SCOPE } from '../internal/acting-tenant.js';
import {
  type CreateUploadBody,
  createUploadBody,
  type Upload,
  type UploadDownload,
  type UploadReservation,
} from './representation.js';
import { UploadsService } from './uploads.service.js';

const uploadId = new ZodValidationPipe(z.uuid());
const ApiUploadIdParam = () => ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } });

/**
 * Uploads for the caller's tenant. Who may upload is decided per purpose (roster-import:
 * reporting-officer), so the service checks roles rather than a controller-level `@Roles`.
 */
@ApiTags('uploads')
@Controller('v1/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'createUpload',
    summary: 'Reserve an upload and get a presigned PUT to quarantine',
    description:
      "The purpose's roles only (roster-import: reporting-officer). The PUT URL is valid for 15 minutes and accepts exactly the declared Content-Type and size.",
  })
  @ApiBody({ required: true, schema: schemaRef('CreateUpload') })
  @ApiCreatedResponse({
    description: 'Upload reserved; PUT the bytes to uploadUrl before expiresAt',
    schema: schemaRef('UploadReservation'),
  })
  @ApiProblemResponse(400, "Request failed validation, or the type or size is not the purpose's")
  @ApiProblemResponse(403, 'Your roles do not allow uploads for this purpose')
  create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createUploadBody)) body: CreateUploadBody,
  ): Promise<UploadReservation> {
    return this.uploads.create(principal, body);
  }

  @Get(':id')
  @ApiUploadIdParam()
  @ApiOperation({
    operationId: 'getUpload',
    summary: 'Upload state and metadata',
    description:
      "Uploads of the caller's tenant whose purpose the caller's roles cover; any other is 404.",
  })
  @ApiOkResponse({ description: 'The upload', schema: schemaRef('Upload') })
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uploadId) id: string,
  ): Promise<Upload> {
    return this.uploads.get(principal, id);
  }

  @Post(':id/complete')
  @RequireIdempotencyKey()
  @ApiUploadIdParam()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'completeUpload',
    summary: 'Verify, scan and move the uploaded object to the clean bucket',
    description:
      'Synchronous, bounded by a 60-second budget. Returns the final state: clean, infected or rejected (type, size, missing, timeout). The quarantine object is deleted in every case.',
  })
  @ApiOkResponse({ description: 'Final state after scanning', schema: schemaRef('Upload') })
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  @ApiProblemResponse(
    409,
    'Problem type `upload-completed` (already clean, infected or rejected), `upload-expired`, or `upload-completing` (another request is completing it).',
  )
  @ApiProblemResponse(
    503,
    'Problem type `upload-check-unavailable`: storage or the scanner failed; nothing changed, retry.',
  )
  complete(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uploadId) id: string,
  ): Promise<Upload> {
    return this.uploads.complete(principal, id);
  }
}

/** Internal: not routed by the public entrypoint. Callers are services acting for a tenant. */
@ApiTags('internal')
@Controller('internal/v1/uploads')
@InternalApi(DOCUMENTS_INTERNAL_SCOPE)
export class InternalUploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get(':id/download')
  @AuditedRead({ action: 'upload.download.issued', resource: 'upload' })
  @ApiUploadIdParam()
  @ApiOperation({
    operationId: 'getUploadDownload',
    summary: 'Short-lived presigned GET on a clean object, for services',
    description:
      'Service tokens with scope documents:internal, acting for the tenant in X-Acting-Tenant. The URL is valid for 5 minutes.',
  })
  @ApiOkResponse({
    description: 'Download URL valid for a few minutes',
    schema: schemaRef('UploadDownload'),
  })
  @ApiProblemResponse(404, "Not found, or not the acting tenant's upload")
  @ApiProblemResponse(409, 'Problem type `upload-not-clean`: the upload is not clean')
  download(
    @CurrentPrincipal() principal: Principal,
    @ActingTenant() tenant: string,
    @Param('id', uploadId) id: string,
  ): Promise<UploadDownload> {
    return this.uploads.download(principal, tenant, id);
  }
}
