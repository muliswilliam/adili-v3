import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { sectionKeySchema } from '../drafts/representation.js';
import { ApiDeclarationIdParam, NOT_VISIBLE } from '../http.js';
import type { SuggestionSet } from './representation.js';
import { SuggestionsService } from './suggestions.service.js';

const setList = { type: 'array', items: schemaRef('SuggestionSet') } as const;

const suggestionsQuery = z.object({
  personKey: z.string().optional().meta({ description: 'Only the sets of this person' }),
  sectionKey: sectionKeySchema
    .optional()
    .meta({ description: 'Only the suggestions for this section (and sets with none yet)' }),
});

/**
 * Registry suggestions on a draft (spec 05b). Declarant only, by the `person_id` claim; any other
 * caller gets 404.
 */
@ApiTags('suggestions')
@Controller('v1/declarations/:declarationId/suggestions')
@ApiDeclarationIdParam()
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Post('lookups')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'requestRegistryLookups',
    summary:
      'Check registries for a household person with recorded consent (declarant); results arrive as suggestions',
    description:
      'The officer is looked up by the national ID on their roster record; a spouse or child by the one in Household. Records the consent (who, when, text version, registries) and answers one `pending` set per registry: the integration-gateway is asked for each with legal basis `declarant-request` and the declaration as case reference, retried with backoff while a registry does not answer, then `unavailable`. Poll `listSuggestions` until no set is `pending`. Records `declaration.lookup-requested.v1`, and `declaration.suggestions-ready.v1` per registry that answers. A registry checked again supersedes its earlier `new` suggestions for the person.',
  })
  @ApiBody({ required: true, schema: schemaRef('RegistryLookupRequest') })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Lookups started; one set per system',
    schema: setList,
  })
  @ApiProblemResponse(
    400,
    'The declarant did not request the check (`consent-required`), the spouse or child has no national ID in Household (`no-id`), or the request failed validation (an unknown registry, or a person not in the household)',
  )
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(409, 'Not a draft (`declaration-not-draft`)')
  requestLookups(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Body() body: unknown,
  ): Promise<SuggestionSet[]> {
    return this.suggestions.requestLookups(principal, declarationId, body);
  }

  @Get()
  @ApiOperation({
    operationId: 'listSuggestions',
    summary: 'Suggestion sets and suggestions for the draft (declarant)',
    description:
      'Oldest request first. Narrowed to a person, or to the suggestions of a section: a set with suggestions, none in the section, is left out; one with none yet is kept so a pending lookup can be polled.',
  })
  @ApiQueryParameters(suggestionsQuery)
  @ApiOkResponse({ description: 'Sets with suggestions', schema: setList })
  @ApiProblemResponse(400, 'Query failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Query(new ZodValidationPipe(suggestionsQuery)) query: z.infer<typeof suggestionsQuery>,
  ): Promise<SuggestionSet[]> {
    return this.suggestions.list(principal, declarationId, query);
  }
}
