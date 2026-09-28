import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { isSectionKey } from '../declaration/section-key';
import { getBff } from './bff.server';
import {
  type DeclarationListResult,
  type DeclarationResult,
  type DiscardResult,
  discardDeclaration,
  linkAttachment,
  type LinkResult,
  listDeclarations,
  listObligations,
  loadDeclaration,
  loadSection,
  loadSummary,
  type ObligationsResult,
  type SaveOutcome,
  saveSection,
  type SectionResult,
  startDeclaration,
  type StartResult,
  type SummaryResult,
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
const sectionKey = z.string().refine(isSectionKey, 'Not a section key');
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
