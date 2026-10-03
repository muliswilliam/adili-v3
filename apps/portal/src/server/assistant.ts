import { FEEDBACK_REASONS } from '@adili/ui';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { ASSISTANT_NOTE_MAX_LENGTH } from '../assistant/limits';
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
import { env } from './env.server';
import type { Unauthenticated } from './results';

/**
 * An opened conversation, and whether answers can be rated here: rating is an endpoint the
 * service builds with #339, so it is shown only where ASSISTANT_FEEDBACK says it exists.
 */
export type OpenLoad =
  | (Extract<OpenResult, { status: 'ok' }> & { feedback: boolean })
  | Exclude<OpenResult, { status: 'ok' }>;

/** Server functions for the Ask Adili panel; the answer itself streams from an API route. */

const language = z.enum(['en', 'sw']);

export const openAssistantConversation = createServerFn({ method: 'POST' })
  .validator(z.object({ declarationId: z.uuid().nullable(), language }))
  .handler(({ data }): Promise<OpenLoad | Unauthenticated> =>
    asDeclarant(declarationsClient, async (client) => {
      const result = await openConversation(client, data);
      return result.status === 'ok' ? { ...result, feedback: env().ASSISTANT_FEEDBACK } : result;
    }),
  );

export const rateAssistantAnswer = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      conversationId: z.uuid(),
      messageId: z.uuid(),
      rating: z.enum(['helpful', 'not-helpful']),
      reason: z.enum(FEEDBACK_REASONS).nullable(),
      note: z.string().max(ASSISTANT_NOTE_MAX_LENGTH).nullable(),
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
