import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  AuditedRead,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { sectionKeySchema } from '../drafts/representation.js';
import { ApiDeclarationIdParam, etagHeader, NOT_VISIBLE, type Reply } from '../http.js';
import type { Suggestion, SuggestionAcceptance, SuggestionSet } from './representation.js';
import { SuggestionsService } from './suggestions.service.js';

const setList = { type: 'array', items: schemaRef('SuggestionSet') } as const;

const ApiSuggestionIdParam = () =>
  ApiParam({ name: 'suggestionId', schema: { type: 'string', format: 'uuid' } });

const suggestionsQuery = z.object({
  personKey: z.string().optional().meta({ description: 'Only the sets of this person' }),
  sectionKey: sectionKeySchema
    .optional()
    .meta({ description: 'Only the suggestions for this section (and sets with none yet)' }),
});

/**
 * Registry suggestions on a draft (spec 05b). Declarant only, by the `person_id` claim; any other
 * caller gets 404. Every answer holding a suggestion is an audited read (ADR-008), although the
 * declarant reads their own draft: it carries what registries hold about their spouse and
 * children too, as the draft's section reads do.
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
      'The declarant is looked up by the national ID on their person record, as verified at onboarding; a spouse or child by the one in Household. Records the consent (who, when, text version, registries) and answers one `pending` set per registry: the integration-gateway is asked for each with legal basis `declarant-request` and the declaration as case reference, retried with backoff while a registry does not answer, then `unavailable`. Poll `listSuggestions` until no set is `pending`. Records `declaration.lookup-requested.v1` (the audit record of the consent: who, text version, person, registries), and `declaration.suggestions-ready.v1` per registry that answers. A registry checked again supersedes its earlier `new` suggestions for the person, keeping accepted and dismissed ones; what it suggests again that the declarant has dismissed, or accepted and still declares with that identifier (same item type and identifier: registration, parcel, company or KRA PIN; for the income hint, the same section) arrives `superseded`, not `new`.',
  })
  @ApiBody({ required: true, schema: schemaRef('RegistryLookupRequest') })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Lookups started; one set per system',
    schema: setList,
  })
  @ApiProblemResponse(
    400,
    'The declarant did not request the check (`consent-required`), the spouse or child has no national ID in Household (`no-id`), the request failed validation (an unknown registry, or a person not in the household), or the Idempotency-Key header missing',
  )
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Not a draft (`declaration-not-draft`), or a request with the same Idempotency-Key still running',
  )
  @ApiProblemResponse(
    503,
    'The workflow engine could not start the lookups (`workflow-unavailable`): nothing was recorded, no consent and no set; ask again',
  )
  requestLookups(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Body() body: unknown,
  ): Promise<SuggestionSet[]> {
    return this.suggestions.requestLookups(principal, declarationId, body);
  }

  @Get()
  @AuditedRead({ action: 'declaration.suggestions.read', resource: 'declaration' })
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

  @Post(':suggestionId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiSuggestionIdParam()
  @AuditedRead({ action: 'declaration.suggestion.read', resource: 'declaration-suggestion' })
  @ApiOperation({
    operationId: 'acceptSuggestion',
    summary:
      'Add the suggestion as an item, or apply it to an existing item (declarant); through the section save',
    description:
      "A read-modify-write of the suggestion's section on the declarant's behalf, as a section save with `If-Match`: a new item carries the suggestion as its `source` (declaration.v1 `ItemSource`), naming the registry's `verificationResultId` only when the item ends up holding what the registry gave (the description aside), so not for one the declarant edited or whose own differing values were kept; applied to an item (`applyToItemId`), only the fields the item leaves empty are filled unless `overwrite`, and the item takes the `source` if it has none, or with `overwrite`. A registry's suggestion never fills values. Where each type lands: `vehicle`, `land`, `shareholding` an asset of the person's statement; `income-hint` a salary income with no amount; `directorship` a registrable interest in `other`; a spouse's `bio-tax` their KRA PIN in `household` (the declarant's own has no field, 400). A document's reading (source `document`) is different: as new it adds an item of the reading's type in its statement list; its fields are written at their declaration.v1 paths, typed as read, amounts included (`value.kesCents`, `outstanding.kesCents`: the document's figure the declarant checked); a field it did not read is refused (400); applied to an item of another type, 400; it is not refused for an item holding another identifier. The suggestion becomes `accepted` with the item; the save records `declaration.section-saved.v1` and `declaration.suggestion-accepted.v1`.",
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'The draft version read (its ETag)',
    schema: { type: 'string' },
  })
  @ApiBody({ required: true, schema: schemaRef('AcceptSuggestionRequest') })
  @ApiOkResponse({
    description: 'Item added or filled; new draft version in ETag',
    headers: etagHeader(),
    schema: schemaRef('SuggestionAcceptance'),
  })
  @ApiProblemResponse(
    400,
    "Validation failed: the fields do not fit the item (for a document, a field it did not read, or a value the field cannot take), `applyToItemId` is not an item of the suggestion's type in its section or (without `overwrite`) holds another registration, parcel or company, or the suggestion has no place in the declaration (the declarant's own KRA PIN)",
  )
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'The suggestion is not `new` (`not-new`), the draft changed since If-Match (`draft-version-mismatch`; read the section and try again), not a draft (`declaration-not-draft`), or the statement is archived (`section-archived`)',
  )
  @ApiProblemResponse(428, 'If-Match header missing (`if-match-required`)')
  async accept(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Param('suggestionId') suggestionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<SuggestionAcceptance> {
    const result = await this.suggestions.accept(
      principal,
      declarationId,
      suggestionId,
      ifMatch,
      body,
    );
    reply.header('ETag', result.etag);
    return result;
  }

  @Post(':suggestionId/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiSuggestionIdParam()
  @AuditedRead({ action: 'declaration.suggestion.read', resource: 'declaration-suggestion' })
  @ApiOperation({
    operationId: 'dismissSuggestion',
    summary: 'Set a suggestion aside, with an optional reason (declarant)',
    description:
      'The suggestion becomes `dismissed`, with the reason if given; the draft is untouched. Dismissing it again changes nothing. Records `declaration.suggestion-dismissed.v1` (identifiers only). A later check of the registry does not offer it as new again.',
  })
  @ApiBody({ required: false, schema: schemaRef('DismissSuggestionRequest') })
  @ApiOkResponse({ description: 'Dismissed', schema: schemaRef('Suggestion') })
  @ApiProblemResponse(400, 'Validation failed (a reason over 200 characters)')
  @ApiProblemResponse(404, NOT_VISIBLE)
  @ApiProblemResponse(
    409,
    'Not `new` and not dismissed already: accepted, or replaced by a later check (`not-new`); or not a draft (`declaration-not-draft`)',
  )
  dismiss(
    @CurrentPrincipal() principal: Principal,
    @Param('declarationId') declarationId: string,
    @Param('suggestionId') suggestionId: string,
    @Body() body: unknown,
  ): Promise<Suggestion> {
    return this.suggestions.dismiss(principal, declarationId, suggestionId, body);
  }
}
