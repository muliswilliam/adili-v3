import { z } from 'zod';

import { channelSchema } from './send-message.schema.js';

export const messageStatusSchema = z.enum(['sent', 'failed']);

/** `Message`: a message as `POST` and `GET /internal/v1/messages` return it. */
export const messageSchema = z.object({
  id: z.uuid(),
  channel: channelSchema,
  template: z
    .string()
    .meta({ description: 'The `TemplateId` it was rendered from, as recorded when sent' }),
  status: messageStatusSchema,
  error: z.string().nullable().meta({
    description:
      'Reason when failed: timeout, rejected-recipient, provider-error, no-contact or contact-lookup-failed',
  }),
  providerMessageId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type MessageView = z.infer<typeof messageSchema>;
