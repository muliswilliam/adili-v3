import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { DOCUMENT_KINDS } from '../declaration/extraction';
import { isSectionKey, parsePersonKey } from '../declaration/section-key';
import { REGISTRIES } from '../declaration/suggestions';
import { asDeclarant as asDeclarantOf } from './bff.server';
import {
  acceptSuggestion,
  type AcceptOutcome,
  type DeclarationListResult,
  type DeclarationResult,
  type DiscardResult,
  discardDeclaration,
  dismissSuggestion,
  type DismissOutcome,
  extractAttachment,
  type ExtractResult,
  linkAttachment,
  type LinkResult,
  listDeclarations,
  listSuggestions,
  loadDeclaration,
  loadSection,
  loadSummary,
  type RegistryLookupsResult,
  requestLookups,
  type SaveOutcome,
  saveSection,
  type SectionResult,
  startDeclaration,
  type StartResult,
  type SuggestionsResult,
  type SummaryResult,
  type Json,
  unlinkAttachment,
  type UnlinkResult,
} from './declarations.server';
import { declarationsClient, type DeclarationsClient } from './declarations/client.server';
import {
  amendDeclaration,
  type AmendOutcome,
  discardAmendment,
  type DiscardAmendmentOutcome,
} from './my-declarations.server';
import type { Unauthenticated } from './results';

/** Server functions for the declaration workspace. Tokens stay on the server. */

function asDeclarant<T>(call: (client: DeclarationsClient) => Promise<T>) {
  return asDeclarantOf(declarationsClient, call);
}

const id = z.uuid();
const sectionKey = z.string().refine(isSectionKey, 'Not a section key');
const declarationInput = z.object({ declarationId: id });

export const startMyDeclaration = createServerFn({ method: 'POST' })
  .validator(z.object({ obligationId: id }))
  .handler(({ data }): Promise<StartResult | Unauthenticated> =>
    asDeclarant((client) => startDeclaration(client, data.obligationId)),
  );

export const getMyDeclarations = createServerFn({ method: 'GET' }).handler(
  (): Promise<DeclarationListResult | Unauthenticated> => asDeclarant(listDeclarations),
);

export const getDeclaration = createServerFn({ method: 'GET' })
  .validator(declarationInput)
  .handler(({ data }): Promise<DeclarationResult | Unauthenticated> =>
    asDeclarant((client) => loadDeclaration(client, data.declarationId)),
  );

export const getDeclarationSection = createServerFn({ method: 'GET' })
  .validator(z.object({ declarationId: id, sectionKey }))
  .handler(({ data }): Promise<SectionResult | Unauthenticated> =>
    asDeclarant((client) => loadSection(client, data.declarationId, data.sectionKey)),
  );

export const saveDeclarationSection = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      declarationId: id,
      sectionKey,
      ifMatch: z.string().min(1),
      contents: z.record(z.string(), z.unknown()),
    }),
  )
  .handler(({ data }): Promise<SaveOutcome | Unauthenticated> =>
    asDeclarant((client) => saveSection(client, data)),
  );

export const discardMyDeclaration = createServerFn({ method: 'POST' })
  .validator(declarationInput)
  .handler(({ data }): Promise<DiscardResult | Unauthenticated> =>
    asDeclarant((client) => discardDeclaration(client, data.declarationId)),
  );

/** Reopens a submitted declaration as an amendment (spec 06 FE-4). */
export const amendMyDeclaration = createServerFn({ method: 'POST' })
  .validator(declarationInput)
  .handler(({ data }): Promise<AmendOutcome | Unauthenticated> =>
    asDeclarant((client) => amendDeclaration(client, data.declarationId)),
  );

/** Discards an amendment in progress; the submitted version stays in force. */
export const discardMyAmendment = createServerFn({ method: 'POST' })
  .validator(declarationInput)
  .handler(({ data }): Promise<DiscardAmendmentOutcome | Unauthenticated> =>
    asDeclarant((client) => discardAmendment(client, data.declarationId)),
  );

export const linkDeclarationAttachment = createServerFn({ method: 'POST' })
  .validator(z.object({ declarationId: id, sectionKey, itemId: id, uploadId: id }))
  .handler(({ data }): Promise<LinkResult | Unauthenticated> =>
    asDeclarant((client) => linkAttachment(client, data)),
  );

export const unlinkDeclarationAttachment = createServerFn({ method: 'POST' })
  .validator(z.object({ declarationId: id, attachmentId: id }))
  .handler(({ data }): Promise<UnlinkResult | Unauthenticated> =>
    asDeclarant((client) => unlinkAttachment(client, data)),
  );

export const getDeclarationSummary = createServerFn({ method: 'GET' })
  .validator(declarationInput)
  .handler(({ data }): Promise<SummaryResult | Unauthenticated> =>
    asDeclarant((client) => loadSummary(client, data.declarationId)),
  );

const personKey = z.string().refine((value) => parsePersonKey(value) !== null, 'Not a person key');
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(json),
    z.record(z.string(), json),
  ]),
);

export const requestRegistryLookups = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      declarationId: id,
      personKey,
      systems: z.array(z.enum(REGISTRIES)).min(1),
      textVersion: z.string().min(1),
      idempotencyKey: id,
    }),
  )
  .handler(({ data }): Promise<RegistryLookupsResult | Unauthenticated> =>
    asDeclarant((client) => requestLookups(client, data)),
  );

export const listDeclarationSuggestions = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      declarationId: id,
      personKey: personKey.optional(),
      sectionKey: sectionKey.optional(),
    }),
  )
  .handler(({ data }): Promise<SuggestionsResult | Unauthenticated> =>
    asDeclarant((client) => listSuggestions(client, data)),
  );

export const acceptDeclarationSuggestion = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      declarationId: id,
      suggestionId: id,
      ifMatch: z.string().min(1),
      fields: z.record(z.string(), json),
      applyToItemId: id.nullable(),
      overwrite: z.boolean().optional(),
    }),
  )
  .handler(({ data }): Promise<AcceptOutcome | Unauthenticated> =>
    asDeclarant((client) => acceptSuggestion(client, data)),
  );

export const dismissDeclarationSuggestion = createServerFn({ method: 'POST' })
  .validator(
    z.object({ declarationId: id, suggestionId: id, reason: z.string().max(200).optional() }),
  )
  .handler(({ data }): Promise<DismissOutcome | Unauthenticated> =>
    asDeclarant((client) => dismissSuggestion(client, data)),
  );

export const extractDeclarationAttachment = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      declarationId: id,
      attachmentId: id,
      documentKindHint: z.enum(DOCUMENT_KINDS),
      idempotencyKey: id,
    }),
  )
  .handler(({ data }): Promise<ExtractResult | Unauthenticated> =>
    asDeclarant((client) => extractAttachment(client, data)),
  );
