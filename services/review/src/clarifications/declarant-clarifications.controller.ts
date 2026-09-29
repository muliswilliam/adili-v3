import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, schemaRef, ZodValidationPipe } from '@adili/api-kit';

import { DeclarantPerson } from './access.js';
import { uuidParam } from './clarification-input.js';
import { DeclarantClarificationsService } from './declarant-clarifications.service.js';
import type { DeclarantClarificationView } from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

/**
 * The declarant's clarifications (spec 07a), authorised by the `person_id` claim: tokens without
 * it, and other people's clarifications, get 404.
 */
@ApiTags('declarant')
@Controller('v1/me/clarifications')
export class DeclarantClarificationsController {
  constructor(private readonly clarifications: DeclarantClarificationsService) {}

  @Get()
  @ApiOperation({
    operationId: 'getMyClarifications',
    summary: "The declarant's clarifications across Commissions",
  })
  @ApiOkResponse({
    description: 'List',
    schema: { type: 'array', items: schemaRef('DeclarantClarification') },
  })
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(@DeclarantPerson() personId: string): Promise<DeclarantClarificationView[]> {
    return this.clarifications.list(personId);
  }

  @Get(':clarificationId')
  @ApiParam({ name: 'clarificationId', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    operationId: 'getMyClarification',
    summary: 'One clarification with items, letter link and response',
  })
  @ApiOkResponse({ description: 'Clarification', schema: schemaRef('DeclarantClarification') })
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @DeclarantPerson() personId: string,
    @Param('clarificationId', new ZodValidationPipe(uuidParam)) clarificationId: string,
  ): Promise<DeclarantClarificationView> {
    return this.clarifications.get(personId, clarificationId);
  }
}
