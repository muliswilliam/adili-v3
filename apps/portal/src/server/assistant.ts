import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { isSectionKey } from '../declaration/section-key';
import {
  type HelpSearchResult,
  openConversation,
  type OpenResult,
  rateAnswer,
  type RateResult,
  searchHelp,
} from './assistant.server';
import { asDeclarant } from './bff.server';
import { declarationsClient } from './declarations/client.server';
import type { Unauthenticated } from './results';

/** Server functions for the Ask Adili panel; the answer itself streams from an API route. */

const language = z.enum(['en', 'sw']);

export const openAssistantConversation = createServerFn({ method: 'POST' })
  .validator(z.object({ declarationId: z.uuid().nullable(), language }))
  .handler(({ data }): Promise<OpenResult | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => openConversation(client, data)),
  );

export const rateAssistantAnswer = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      conversationId: z.uuid(),
      messageId: z.uuid(),
      rating: z.enum(['helpful', 'not-helpful']),
      reason: z.enum(['inaccurate', 'missed-something', 'unclear', 'too-long', 'other']).nullable(),
      note: z.string().max(500).nullable(),
    }),
  )
  .handler(({ data }): Promise<RateResult | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => {
      const { conversationId, messageId, ...feedback } = data;
      return rateAnswer(client, conversationId, messageId, feedback);
    }),
  );

export const searchAssistantHelp = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      q: z.string().trim().min(2).max(200),
      language,
      sectionKey: z.string().refine(isSectionKey).nullable(),
    }),
  )
  .handler(({ data }): Promise<HelpSearchResult | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => searchHelp(client, data)),
  );
