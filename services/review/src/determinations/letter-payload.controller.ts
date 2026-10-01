import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ActingTenant,
  ApiProblemResponse,
  InternalApi,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { REVIEW_INTERNAL_SCOPE } from '@adili/roles';
import { z } from 'zod';

import {
  type DeterminationLetterPayload,
  DeterminationLetterPayloadService,
} from './letter-payload.service.js';

/**
 * Internal: not routed by the public entrypoint. The documents service pulls a decision letter's
 * fields here when it renders the letter, so no personal data travels in the issue request or in
 * events (spec 08, ADR-010).
 */
@ApiTags('internal')
@Controller('internal/v1/review/determinations')
export class DeterminationLetterPayloadController {
  constructor(private readonly letters: DeterminationLetterPayloadService) {}

  @Get(':determinationId/letter-payload')
  @InternalApi(REVIEW_INTERNAL_SCOPE)
  @ApiParam({ name: 'determinationId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetDeterminationLetterPayload',
    summary: 'Fields the decision letter template needs (documents service)',
  })
  @ApiOkResponse({ description: 'Payload', schema: schemaRef('DeterminationLetterPayload') })
  @ApiProblemResponse(404, 'No approved determination with this id at the acting Commission')
  @ApiProblemResponse(503, 'The Commission directory could not be reached')
  payload(
    @ActingTenant() tenant: string,
    @Param('determinationId', new ZodValidationPipe(z.uuid())) determinationId: string,
  ): Promise<DeterminationLetterPayload> {
    return this.letters.payload(tenant, determinationId);
  }
}
