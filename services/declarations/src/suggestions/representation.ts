import { z } from 'zod';

import { sectionKeySchema } from '../drafts/representation.js';
import { SUGGESTION_SET_STATUSES, SUGGESTION_SOURCES, SUGGESTION_STATUSES } from './schema.js';

/**
 * Bodies of the registry suggestions API (spec 05b). They are the contract: the OpenAPI document,
 * packages/schemas/internal/declarations.yaml, is generated from them (`pnpm contracts`).
 */

/** The registries a declarant can ask to check. */
export const REGISTRY_SYSTEMS = ['kra', 'ntsa', 'brs', 'ardhisasa'] as const;

export const suggestionSourceSchema = z.enum(SUGGESTION_SOURCES);

export const suggestionSchema = z.object({
  id: z.uuid(),
  setId: z.uuid(),
  personKey: z.string(),
  sectionKey: sectionKeySchema,
  itemType: z.string().meta({
    description:
      'What the suggestion proposes: a Second Schedule item type from declaration.v1 (`vehicle` from NTSA, `land` from ArdhiSasa, `shareholding` from BRS), `directorship` (BRS, a paragraph 9 registrable interest of the officer, in `other`), `bio-tax` (KRA PIN and compliance, in `bio` for the officer or `household` for a spouse) or `income-hint` (KRA, a hint to check the salary item, never a value)',
  }),
  fields: z.record(z.string(), z.unknown()).meta({
    description:
      "Proposed fields, by item type: `vehicle` registration, make, model, year; `land` parcelNumber, size, location, county (a declaration.v1 county code); `shareholding` companyName, registrationNumber, role, shares; `directorship` companyName, role; `bio-tax` kraPin, complianceStatus; `income-hint` incomeType. Statement items also carry an editable `description`. Value fields are never set: valuing is the declarant's call",
  }),
  sourceRef: z.record(z.string(), z.unknown()).meta({
    description:
      "The registry's identifiers for the record (registration, parcel, company or KRA PIN number) and facts that do not become fields (registration date, tenure, company status, certificate); for `income-hint`, the declared income in KES cents. Documents: page and field",
  }),
  confidence: z.number().min(0).max(1).nullable(),
  matchItemId: z.uuid().nullable().meta({
    description:
      'The item already in the section whose identifier (registration, parcel, company) coincides: offer "Apply to this item" instead of a duplicate',
  }),
  status: z.enum(SUGGESTION_STATUSES),
  acceptedItemId: z.uuid().nullable(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const suggestionSetSchema = z.object({
  id: z.uuid(),
  personKey: z.string(),
  source: suggestionSourceSchema,
  status: z.enum(SUGGESTION_SET_STATUSES).meta({
    description:
      '`pending` while the registry is being asked (retried with backoff); `ready` when it answered, with or without records; `unavailable` when it did not answer after the retries; `failed` when the check could not run. Poll `listSuggestions` until no set is `pending`',
  }),
  requestedAt: z.iso.datetime(),
  readyAt: z.iso.datetime().nullable(),
  verificationResultId: z.uuid().nullable(),
  aiJobId: z.uuid().nullable(),
  suggestions: z.array(suggestionSchema),
});
export type SuggestionSet = z.infer<typeof suggestionSetSchema>;

export const registryLookupRequestSchema = z.object({
  personKey: z.string().meta({
    description: '`officer`, or a spouse or child of the household (`spouse:<id>`, `child:<id>`)',
  }),
  systems: z.array(z.enum(REGISTRY_SYSTEMS)).min(1),
  consent: z.object({
    requested: z.literal(true).meta({ description: 'The declarant ticked "I request this check"' }),
    textVersion: z.string().min(1).meta({ description: 'The version of the consent text shown' }),
  }),
});
export type RegistryLookupRequest = z.infer<typeof registryLookupRequestSchema>;

export const acceptSuggestionRequestSchema = z.object({
  fields: z.record(z.string(), z.unknown()).meta({
    description:
      "The suggestion's fields as the declarant accepts them, after any edits (`Suggestion.fields` names). Value fields are not taken: the declarant enters values on the item",
  }),
  applyToItemId: z.uuid().nullable().meta({
    description:
      "The item to fill instead of adding one: usually the suggestion's `matchItemId`, of the same type in the same section (for `directorship`, a directorship's `id`). Null adds a new item",
  }),
  overwrite: z.boolean().optional().meta({
    description:
      'When applying to an existing item, also replace the fields it already has; without it (false), only empty ones are filled',
  }),
});
export type AcceptSuggestionRequest = z.infer<typeof acceptSuggestionRequestSchema>;

export const suggestionAcceptanceSchema = z.object({
  suggestion: suggestionSchema,
  itemId: z.uuid().meta({
    description:
      "The item added or filled: an asset or income of the person's statement, a directorship in `other`, or the spouse in `household` (for a spouse's KRA PIN)",
  }),
  etag: z.string().meta({ description: 'The new draft version, as in the `ETag` header' }),
});
export type SuggestionAcceptance = z.infer<typeof suggestionAcceptanceSchema>;

export const dismissSuggestionRequestSchema = z.object({
  reason: z
    .string()
    .max(200)
    .optional()
    .meta({ description: 'Why the declarant set it aside, if they said' }),
});
export type DismissSuggestionRequest = z.infer<typeof dismissSuggestionRequestSchema>;
