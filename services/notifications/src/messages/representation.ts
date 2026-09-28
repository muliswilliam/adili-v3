import { z } from 'zod';

import type { MessageView } from './messages.service.js';
import { channelSchema, templateIdSchema } from './send-message.schema.js';

export const messageStatusSchema = z.enum(['sent', 'failed']);

/** `Message`: a message as the messages API returns it. */
export const messageSchema = z.object({
  id: z.uuid(),
  channel: channelSchema,
  template: templateIdSchema,
  status: messageStatusSchema,
  error: z.string().nullable().meta({
    description: 'Reason when failed: timeout, rejected-recipient or provider-error',
  }),
  providerMessageId: z.string().nullable(),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<MessageView>;
