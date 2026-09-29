import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, schemaRef, ZodValidationPipe } from '@adili/api-kit';
import { z } from 'zod';

import { ActingTenant, InternalRoute } from '../internal-api/acting-tenant.js';
import { type ActionLetterPayload, ActionLetterPayloadService } from './letter-payload.service.js';

/**
 * Internal: not routed by the public entrypoint. The documents service pulls a ladder step's
 * letter fields here when it renders the letter, so no personal data travels in the issue request,
 * in events or in workflow history (spec 08, ADR-010).
 */
@ApiTags('internal')
@Controller('internal/v1/review/actions')
export class ActionLetterPayloadController {
  constructor(private readonly letters: ActionLetterPayloadService) {}

  @Get(':actionId/letter-payload')
  @InternalRoute()
  @ApiParam({ name: 'actionId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'internalGetActionLetterPayload',
    summary: 'Fields the notice to comply and warning templates need (documents service)',
  })
  @ApiOkResponse({ description: 'Payload', schema: schemaRef('ActionLetterPayload') })
  @ApiProblemResponse(404, 'No approved step with this id at the acting Commission')
  @ApiProblemResponse(503, 'The Commission directory could not be reached')
  payload(
    @ActingTenant() tenant: string,
    @Param('actionId', new ZodValidationPipe(z.uuid())) actionId: string,
  ): Promise<ActionLetterPayload> {
    return this.letters.payload(tenant, actionId);
  }
}
