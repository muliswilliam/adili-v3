import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { languageSchema } from '../language';
import { asDeclarant } from './bff.server';
import { type SavePreferredLanguageResult, savePreferredLanguage } from './declarant.server';
import { directoryClient } from './directory/client.server';
import type { Unauthenticated } from './results';

/**
 * The declarant's preferences (spec 07c FE-3): the language a clarification letter to them starts
 * in. Tokens stay on the server.
 */
export const setMyPreferredLanguage = createServerFn({ method: 'POST' })
  .validator(z.object({ language: languageSchema }))
  .handler(({ data }): Promise<SavePreferredLanguageResult | Unauthenticated> =>
    asDeclarant(directoryClient, (client) => savePreferredLanguage(client, data.language)),
  );
