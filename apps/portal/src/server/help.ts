import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { languageSchema } from '../language';
import { type HelpSearchResult, searchHelp } from './assistant.server';
import { asDeclarant } from './bff.server';
import { declarationsClient } from './declarations/client.server';
import { getHelpPassage, type HelpPassageResult } from './help.server';
import type { Unauthenticated } from './results';

/** Server functions for the help pages (spec 11 FE-3): search and one passage. */

const language = languageSchema;

/** How many passages a help page lists: the most the search endpoint gives. */
export const HELP_PAGE_LIMIT = 20;

export const searchHelpPages = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      q: z.string().trim().min(2).max(200),
      language,
      limit: z.number().int().min(1).max(HELP_PAGE_LIMIT).default(HELP_PAGE_LIMIT),
    }),
  )
  .handler(({ data }): Promise<HelpSearchResult | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => searchHelp(client, { ...data, sectionKey: null })),
  );

export const readHelpPassage = createServerFn({ method: 'GET' })
  .validator(z.object({ passageId: z.string().min(1).max(100), language }))
  .handler(({ data }): Promise<HelpPassageResult | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => getHelpPassage(client, data)),
  );
