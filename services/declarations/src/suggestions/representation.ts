import { z } from 'zod';

import { sectionKeySchema } from '../drafts/representation.js';
import {
  DOCUMENT_KINDS,
  EXTRACTION_FAILURES,
  SUGGESTION_SET_STATUSES,
  SUGGESTION_SOURCES,
  SUGGESTION_STATUSES,
} from './schema.js';

/**
 * Bodies of the pre-fill suggestions API (spec 05b): registry lookups and document readings. They are the contract: the OpenAPI document,
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
      'What the suggestion proposes: a Second Schedule item type from declaration.v1 (`vehicle` from NTSA, `land` from ArdhiSasa, `shareholding` from BRS, the type a document was read into), `directorship` (BRS, a paragraph 9 registrable interest of the declarant, in `other`), `bio-tax` (KRA PIN and compliance, in `bio` for the declarant or `household` for a spouse) or `income-hint` (KRA, a hint to check the salary item, never a value)',
  }),
  fields: z.record(z.string(), z.unknown()).meta({
    description:
      "Proposed fields, by item type: `vehicle` registration, make, model, year; `land` parcelNumber, size, location, county (a declaration.v1 county code); `shareholding` companyName, registrationNumber, role, shares; `directorship` companyName, role; `bio-tax` kraPin, complianceStatus; `income-hint` incomeType. Statement items also carry an editable `description`. Value fields are never set: valuing is the declarant's call. A document's reading (source `document`) names its fields by their declaration.v1 path within the item instead (`details.registration`, `outstanding.kesCents`, `location.county`), typed as the item types them, amounts included: what the document says",
  }),
  sourceRef: z.record(z.string(), z.unknown()).meta({
    description:
      "The registry's identifiers for the record (registration, parcel, company or KRA PIN number) and facts that do not become fields (registration date, tenure, company status, certificate); for `income-hint`, the declared income in KES cents. A document's reading: `documentKind` (what the reading took the document for), `fields` (`[{name, confidence, page}]`, each field's confidence from 0 to 1 and the page it is on, null when on none), `warnings` (what the declarant should know, such as an unreadable page) and `attachmentId`",
  }),
  confidence: z.number().min(0).max(1).nullable().meta({
    description:
      "A document's reading: its least sure field's confidence, null when it read none. Null for a registry's",
  }),
  matchItemId: z.uuid().nullable().meta({
    description:
      'The item already in the section whose identifier (registration, parcel, company) coincides, or for a document the item it is attached to: offer "Apply to this item" instead of a duplicate',
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
      "`pending` while the registry is being asked (retried with backoff) or the document read; `ready` when it answered, with or without records, or the document was read (one suggestion); `unavailable` when a registry did not answer after the retries; `not-enabled` when the Commission's AI policy does not let documents be read; `failed` when the check or reading could not run (for a document, `reason` says why). Poll `listSuggestions` until no set is `pending`",
  }),
  requestedAt: z.iso.datetime(),
  readyAt: z.iso.datetime().nullable(),
  verificationResultId: z.uuid().nullable(),
  aiJobId: z.uuid().nullable(),
  attachmentId: z.uuid().nullable().meta({ description: "A document's set: the attachment read" }),
  documentKind: z
    .enum(DOCUMENT_KINDS)
    .nullable()
    .meta({ description: "A document's set: what the declarant said the document is" }),
  reason: z.enum(EXTRACTION_FAILURES).nullable().meta({
    description:
      "Why a document's set is `failed`: `document-unavailable` (the file could not be fetched in time: try again), `document-unreadable` (damaged, too long, or a type a reading does not take), `not-read` (nothing usable came back) or `unavailable` (the reading service could not do it now: try again). Null otherwise",
  }),
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
      "The suggestion's fields as the declarant accepts them, after any edits (`Suggestion.fields` names). For a registry's, value fields are not taken: the declarant enters values on the item. For a document's reading, its fields by declaration.v1 path, values included, each typed as read (an amount may come as text, e.g. \"1,180,000\"); fields it did not read are refused",
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

export const extractAttachmentRequestSchema = z.object({
  documentKindHint: z.enum(DOCUMENT_KINDS).meta({ description: 'What the declarant says it is' }),
  language: z
    .enum(['en', 'sw'])
    .default('en')
    .meta({ description: 'The language of the warnings the reading gives' }),
});
export type ExtractAttachmentRequest = z.infer<typeof extractAttachmentRequestSchema>;
