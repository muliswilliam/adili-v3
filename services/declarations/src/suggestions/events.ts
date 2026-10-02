import type { NewEvent } from '@adili/events';

import type { SuggestionSource } from './schema.js';

/**
 * Events the declarations service publishes about registry suggestions (spec 05b). Identifiers
 * only: no national ID, registry record or proposed field (ADR-013 §3). The `tenant` extension
 * is the Commission's slug; the subject is the declaration.
 */

export const DECLARATION_LOOKUP_REQUESTED = 'declaration.lookup-requested.v1';

/** The declarant asked, with their consent recorded, for registries to be checked for a person. */
export interface DeclarationLookupRequestedData extends Record<string, unknown> {
  declarationId: string;
  /** `officer`, `spouse:<id>` or `child:<id>`: the household's own keys. */
  personKey: string;
  systems: string[];
  consentId: string;
}

export function declarationLookupRequested(
  tenant: string,
  data: DeclarationLookupRequestedData,
): NewEvent<DeclarationLookupRequestedData> {
  return { type: DECLARATION_LOOKUP_REQUESTED, subject: data.declarationId, tenant, data };
}

export const DECLARATION_SUGGESTIONS_READY = 'declaration.suggestions-ready.v1';

/** A registry answered a lookup: the set is `ready` with `count` suggestions (maybe none). */
export interface DeclarationSuggestionsReadyData extends Record<string, unknown> {
  declarationId: string;
  setId: string;
  source: SuggestionSource;
  count: number;
}

export function declarationSuggestionsReady(
  tenant: string,
  data: DeclarationSuggestionsReadyData,
): NewEvent<DeclarationSuggestionsReadyData> {
  return { type: DECLARATION_SUGGESTIONS_READY, subject: data.declarationId, tenant, data };
}
