import { z } from 'zod';

import { isTemplateId, templateChannel } from './templates.js';

// ITU-T E.164: a plus, a country code that never starts with 0, at most 15 digits.
const E164 = /^\+[1-9]\d{7,14}$/;
const email = z.email();

/** Body of `POST /internal/v1/messages` (notifications.yaml `SendMessage`). */
export const sendMessageSchema = z
  .object({
    channel: z.enum(['email', 'sms']),
    recipient: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('address'), to: z.string().trim().min(1).max(254) }),
      z.object({ kind: z.literal('person'), personId: z.uuid() }),
    ]),
    template: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
    locale: z.enum(['en', 'sw']).default('en'),
    tenant: z.string().min(1).max(64).optional(),
  })
  .superRefine((body, ctx) => {
    const { channel, recipient, template } = body;
    if (recipient.kind === 'person') {
      // Needs the directory's contact lookup, which does not exist yet.
      ctx.addIssue({
        code: 'custom',
        path: ['recipient', 'kind'],
        message: 'person recipients are not supported yet; send an address',
      });
    } else if (channel === 'email' && !email.safeParse(recipient.to).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['recipient', 'to'],
        message: 'must be an email address on the email channel',
      });
    } else if (channel === 'sms' && !E164.test(recipient.to)) {
      ctx.addIssue({
        code: 'custom',
        path: ['recipient', 'to'],
        message: 'must be an E.164 phone number such as +254712345678 on the sms channel',
      });
    }
    if (!isTemplateId(template)) {
      ctx.addIssue({ code: 'custom', path: ['template'], message: 'unknown template' });
    } else if (templateChannel(template) !== channel) {
      ctx.addIssue({
        code: 'custom',
        path: ['template'],
        message: `is a ${templateChannel(template)} template, not ${channel}`,
      });
    }
  });

export type SendMessage = z.infer<typeof sendMessageSchema>;
