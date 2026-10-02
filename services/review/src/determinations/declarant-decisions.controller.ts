import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, schemaRef } from '@adili/api-kit';

import { DeclarantPerson } from '../clarifications/access.js';
import { DeclarantDecisionsService } from './declarant-decisions.service.js';
import type { DeclarantDecisionView } from './representation.js';

/**
 * The declarant's decisions (spec 08), authorised by the `person_id` claim: tokens without it get
 * 404, and nobody sees another person's.
 */
@ApiTags('declarant')
@Controller('v1/me/decisions')
export class DeclarantDecisionsController {
  constructor(private readonly decisions: DeclarantDecisionsService) {}

  @Get()
  @ApiOperation({
    operationId: 'getMyDecisions',
    summary: "The declarant's approved determinations",
  })
  @ApiOkResponse({
    description: 'List',
    schema: { type: 'array', items: schemaRef('DeclarantDecision') },
  })
  @ApiProblemResponse(404, 'Not found, or not visible to the caller')
  list(@DeclarantPerson() personId: string): Promise<DeclarantDecisionView[]> {
    return this.decisions.list(personId);
  }
}
