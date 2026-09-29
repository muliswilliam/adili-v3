import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, schemaRef, ZodValidationPipe } from '@adili/api-kit';

import { ActingTenant, InternalRoute } from '../internal-api/acting-tenant.js';
import { uuidParam } from './clarification-input.js';
import { type ClarificationLetterPayload, LetterPayloadService } from './letter-payload.service.js';

/**
 * Internal: not routed by the public entrypoint. The documents service pulls a clarification
 * letter's fields here when it renders the letter, so no personal data travels in the issue
 * request or in events (spec 07a, ADR-010).
 */
@ApiTags('internal')
@Controller('internal/v1/review/clarifications')
export class LetterPayloadController {
  constructor(private readonly letters: LetterPayloadService) {}

  @Get(':clarificationId/letter-payload')
  @InternalRoute()
  @ApiParam({ name: 'clarificationId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetClarificationLetterPayload',
    summary: 'Fields the clarification letter template needs (documents service)',
  })
  @ApiOkResponse({ description: 'Payload', schema: schemaRef('ClarificationLetterPayload') })
  @ApiProblemResponse(404, 'No issued clarification with this id at the acting Commission')
  @ApiProblemResponse(502, 'The declaration could not be read')
  @ApiProblemResponse(503, 'The Commission directory could not be reached')
  payload(
    @ActingTenant() tenant: string,
    @Param('clarificationId', new ZodValidationPipe(uuidParam)) clarificationId: string,
  ): Promise<ClarificationLetterPayload> {
    return this.letters.payload(tenant, clarificationId);
  }
}
