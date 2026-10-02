import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { DECLARANT } from '@adili/roles';
import { z } from 'zod';

import { CertifiedCopiesService } from './certified-copies.service.js';
import {
  type CertifiedCopy,
  type CertifiedCopyRequest,
  certifiedCopyRequestSchema,
} from './representation.js';

/** A declarant's certified copies of their own submitted versions (spec 10, self-access). */
@ApiTags('declarant')
@Controller('v1/me/certified-copies')
export class CertifiedCopiesController {
  constructor(private readonly copies: CertifiedCopiesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(DECLARANT)
  @AcceptIdempotencyKey()
  @ApiOperation({
    operationId: 'requestCertifiedCopy',
    summary: 'Certified copy of one of my submitted versions',
    description:
      'Records the copy `pending` and has it issued as a Restricted `certified-copy` from the full document of the version (registered `self-access`, `access.certified-copy.issued.v1`); poll until `issued` (then download it from documents with `documentId`) or `failed` (no such submitted version of yours at the Commission). Asking again for the same version returns the same copy; a failed one is tried again.',
  })
  @ApiBody({ required: true, schema: schemaRef('CertifiedCopyRequest') })
  @ApiAcceptedResponse({ description: 'The copy as it stands', schema: schemaRef('CertifiedCopy') })
  @ApiProblemResponse(400, 'The body failed validation')
  @ApiProblemResponse(404, 'Not a declarant, or no such Commission')
  @ApiProblemResponse(
    503,
    'The directory or the workflow engine cannot be reached; nothing was done',
  )
  request(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(certifiedCopyRequestSchema)) body: CertifiedCopyRequest,
  ): Promise<CertifiedCopy> {
    return this.copies.request(principal, body);
  }

  @Get()
  @Roles(DECLARANT)
  @ApiOperation({
    operationId: 'listMyCertifiedCopies',
    summary: 'My certified copies',
    description: 'Latest asked for first, whether asked online or recorded by an access officer.',
  })
  @ApiOkResponse({
    description: 'Copies',
    schema: { type: 'array', items: schemaRef('CertifiedCopy') },
  })
  @ApiProblemResponse(404, 'Not a declarant')
  list(@CurrentPrincipal() principal: Principal): Promise<CertifiedCopy[]> {
    return this.copies.list(principal);
  }

  @Get(':copyId')
  @Roles(DECLARANT)
  @ApiParam({ name: 'copyId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getMyCertifiedCopy',
    summary: 'One of my certified copies',
    description: 'For following a copy from `pending` to `issued` (or `failed`).',
  })
  @ApiOkResponse({ description: 'The copy', schema: schemaRef('CertifiedCopy') })
  @ApiProblemResponse(400, 'copyId is not a UUID')
  @ApiProblemResponse(404, 'No such certified copy of yours')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('copyId', new ZodValidationPipe(z.uuid())) copyId: string,
  ): Promise<CertifiedCopy> {
    return this.copies.get(principal, copyId);
  }
}
