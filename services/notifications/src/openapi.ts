import type { z } from 'zod';

import { messageSchema, messageStatusSchema } from './messages/representation.js';
import {
  channelSchema,
  recipientSchema,
  sendMessageBody,
  templateIdSchema,
} from './messages/send-message.schema.js';

/**
 * Named schemas of the notifications service's OpenAPI document (`#/components/schemas/<name>`),
 * which is exported to packages/schemas/internal/notifications.yaml by `pnpm contracts`.
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  Channel: channelSchema,
  TemplateId: templateIdSchema,
  Recipient: recipientSchema,
  SendMessage: sendMessageBody,
  MessageStatus: messageStatusSchema,
  Message: messageSchema,
};
