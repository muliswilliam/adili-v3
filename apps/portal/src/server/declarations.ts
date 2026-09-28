import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from './bff.server';
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
  listObligations,
  listSuggestions,
  loadDeclaration,
  loadSection,
  loadSummary,
  type ObligationsResult,
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

/** Server functions for the declaration workspace. Tokens stay on the server. */

export interface Unauthenticated {
  status: 'unauthenticated';
}

async function asDeclarant<T>(
  call: (client: DeclarationsClient) => Promise<T>,
): Promise<T | Unauthenticated> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { status: 'unauthenticated' };
  return call(declarationsClient(session.accessToken));
}

const id = z.uuid();
const sectionKey = z
  .string()
  .regex(/^(bio|household|other|statement:(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36}))$/);
const declarationInput = z.object({ declarationId: id });

export const getMyObligations = createServerFn({ method: 'GET' }).handler(
  (): Promise<ObligationsResult | Unauthenticated> => asDeclarant(listObligations),
);

export const startDeclarationFn = createServerFn({ method: 'POST' })
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

export const discardDeclarationFn = createServerFn({ method: 'POST' })
  .validator(declarationInput)
  .handler(({ data }): Promise<DiscardResult | Unauthenticated> =>
    asDeclarant((client) => discardDeclaration(client, data.declarationId)),
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

const personKey = z.string().regex(/^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$/);
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
      systems: z.array(z.enum(['kra', 'ntsa', 'brs', 'ardhisasa'])).min(1),
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
      documentKindHint: z.enum([
        'title-deed',
        'logbook',
        'payslip',
        'bank-letter',
        'share-certificate',
        'other',
      ]),
      targetItemType: z.string().min(1).max(40),
      language: z.enum(['en', 'sw']).optional(),
      idempotencyKey: id,
    }),
  )
  .handler(({ data }): Promise<ExtractResult | Unauthenticated> =>
    asDeclarant((client) => extractAttachment(client, data)),
  );
