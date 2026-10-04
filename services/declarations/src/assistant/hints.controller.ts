import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { ApiDeclarationIdParam, NOT_VISIBLE } from '../http.js';
import { HintsService } from './hints.service.js';
import { type CompletenessHints, type HintsQuery, hintsQuery } from './representation.js';

/** Summary hints (spec 11 S5): AI-assisted hints beneath the summary's residuals. */
@ApiTags('assistant')
@Controller('v1/declarations/:declarationId/hints')
export class HintsController {
  constructor(private readonly hints: HintsService) {}

  @Get()
  @ApiDeclarationIdParam()
  @ApiOperation({
    operationId: 'getCompletenessHints',
    summary:
      "Plain-language hints for the summary's residuals (AI-assisted; the deterministic text is always there)",
    description:
      "Declarants, on their own draft. The summary's `blocking`, each with an AI-assisted hint from the ai-gateway's hints mode when it has one. The gateway gets the declaration type, the household as counts and the residuals as rule ids and field paths, persons by their place only: no contents, no statement date. Hints already written for the same residuals, language and prompt version are served from a cache shared by every declarant; otherwise the service waits up to 10 s for them. `status` `pending`: still being written, ask again; `unavailable`: no AI now, the text only. 404 for a draft that is not the caller's or not being edited.",
  })
  @ApiQueryParameters(hintsQuery)
  @ApiOkResponse({ description: 'Hints', schema: schemaRef('CompletenessHints') })
  @ApiProblemResponse(400, 'Query failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Query(new ZodValidationPipe(hintsQuery)) query: HintsQuery,
  ): Promise<CompletenessHints> {
    return this.hints.hints(principal, declarationId, query);
  }
}
