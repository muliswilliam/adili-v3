import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  schemaRef,
  TENANT_KEY,
  ZodValidationPipe,
} from '@adili/api-kit';

import { NOT_VISIBLE } from '../http.js';
import { type QuestionThemeCount, type ThemesQuery, themesQuery } from './representation.js';
import { ThemeCounts } from './theme-counts.js';

/** Question themes (spec 11 S8): a Commission's anonymised Ask Adili counts. */
@ApiTags('help')
@Controller('v1/commissions/:slug/help/themes')
export class ThemesController {
  constructor(private readonly counts: ThemeCounts) {}

  @Get()
  @ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } })
  @ApiOperation({
    operationId: 'getQuestionThemes',
    summary: "Anonymised counts of the Commission's declarants' questions per month and theme",
    description:
      "The Commission's administrators and reporting officers; anyone else gets 404. Each question its declarants asked Ask Adili, counted once its answer was stored (a question whose answer could not be had is not), by the month asked (Nairobi) and its theme, with how many the Act, Regulations and help articles could not answer. Counts only: no text, no person. They outlive the conversations they count. Newest month first, then the most asked.",
  })
  @ApiQueryParameters(themesQuery)
  @ApiOkResponse({
    description: 'Counts',
    schema: { type: 'array', items: schemaRef('QuestionThemeCount') },
  })
  @ApiProblemResponse(400, 'Query failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(themesQuery)) query: ThemesQuery,
  ): Promise<QuestionThemeCount[]> {
    return this.counts.read(principal, slug, query);
  }
}
