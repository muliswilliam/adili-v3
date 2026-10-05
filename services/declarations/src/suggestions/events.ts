import type { NewEvent } from '@adili/events';
import type { PersonKey } from '@adili/forms';

import type { RegistrySystem } from './registry-results.js';
import type { SuggestionSource } from './schema.js';

/**
 * Events the declarations service publishes about pre-fill suggestions (spec 05b). Identifiers
 * only: no national ID, registry record or proposed field (ADR-013 §3). The `tenant` extension
 * is the Commission's slug; the subject is the declaration.
 */

export const DECLARATION_LOOKUP_REQUESTED = 'declaration.lookup-requested.v1';

/**
 * The declarant asked, with their consent, for registries to be checked for a person: the audit
 * record of the consent (ADR-008), whom it was given by, on which text and for which registries;
 * the event's time is when. The draft's own copy expires with it (`expiry.ts`).
 */
export interface DeclarationLookupRequestedData extends Record<string, unknown> {
  declarationId: string;
  /** `officer`, `spouse:<id>` or `child:<id>`: the household's own keys. */
  personKey: PersonKey;
  systems: RegistrySystem[];
  consentId: string;
  /** The declarant's account (`sub`) that gave the consent. */
  consentedBy: string;
  /** The version of the consent text the declarant was shown. */
  consentTextVersion: string;
}

export function declarationLookupRequested(
  tenant: string,
  data: DeclarationLookupRequestedData,
): NewEvent<DeclarationLookupRequestedData> {
  return { type: DECLARATION_LOOKUP_REQUESTED, subject: data.declarationId, tenant, data };
}

export const DECLARATION_SUGGESTIONS_READY = 'declaration.suggestions-ready.v1';

/**
 * A registry answered a lookup: the set is `ready`, offering `count` new suggestions (maybe none;
 * what repeats a decision the declarant made, or arrives after a later check, is not counted).
 */
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

export const DECLARATION_SUGGESTION_ACCEPTED = 'declaration.suggestion-accepted.v1';

/**
 * The declarant accepted a suggestion: the item it added or filled, saved in the same transaction
 * as the section (whose `declaration.section-saved.v1` is the audit record of the write).
 */
export interface DeclarationSuggestionAcceptedData extends Record<string, unknown> {
  declarationId: string;
  suggestionId: string;
  setId: string;
  source: SuggestionSource;
  sectionKey: string;
  itemId: string;
  /** Applied to an item already declared, rather than added as a new one. */
  applied: boolean;
}

export function declarationSuggestionAccepted(
  tenant: string,
  data: DeclarationSuggestionAcceptedData,
): NewEvent<DeclarationSuggestionAcceptedData> {
  return { type: DECLARATION_SUGGESTION_ACCEPTED, subject: data.declarationId, tenant, data };
}

export const DECLARATION_SUGGESTION_DISMISSED = 'declaration.suggestion-dismissed.v1';

/** The declarant set a suggestion aside. The reason they gave stays with the suggestion. */
export interface DeclarationSuggestionDismissedData extends Record<string, unknown> {
  declarationId: string;
  suggestionId: string;
  setId: string;
  source: SuggestionSource;
}

export function declarationSuggestionDismissed(
  tenant: string,
  data: DeclarationSuggestionDismissedData,
): NewEvent<DeclarationSuggestionDismissedData> {
  return { type: DECLARATION_SUGGESTION_DISMISSED, subject: data.declarationId, tenant, data };
}

export const DECLARATION_EXTRACTION_REQUESTED = 'declaration.extraction-requested.v1';

/**
 * The declarant asked for an attached document to be read into the form: the audit record of the
 * request (ADR-008), naming the ai-gateway job that reads it (absent when the file was not one a
 * reading takes, so nothing was sent). The job is the gateway's own audit record of the reading.
 */
export interface DeclarationExtractionRequestedData extends Record<string, unknown> {
  declarationId: string;
  attachmentId: string;
  setId: string;
  aiJobId: string | null;
}

export function declarationExtractionRequested(
  tenant: string,
  data: DeclarationExtractionRequestedData,
): NewEvent<DeclarationExtractionRequestedData> {
  return { type: DECLARATION_EXTRACTION_REQUESTED, subject: data.declarationId, tenant, data };
}
