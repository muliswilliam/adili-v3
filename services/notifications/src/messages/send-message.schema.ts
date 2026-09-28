import { z } from 'zod';

import { CHANNELS, isTemplateId, LOCALES, templateChannel, templateParams } from './templates.js';

// ITU-T E.164: a plus, a country code that never starts with 0, at most 15 digits.
const E164 = /^\+[1-9]\d{7,14}$/;
const email = z.email();

/** Body of `POST /internal/v1/messages` (notifications.yaml `SendMessage`). */
export const sendMessageSchema = z
  .object({
    channel: z.enum(CHANNELS),
    recipient: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('address'), to: z.string().trim().min(1).max(254) }),
      z.object({ kind: z.literal('person'), personId: z.uuid() }),
    ]),
    template: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
    locale: z.enum(LOCALES).default('en'),
    tenant: z.string().min(1).max(64).optional(),
  })
  // One pass, so a caller sees every recipient, template and params error in one response.
  .superRefine((body, ctx) => {
    const { channel, recipient, template, params } = body;
    // A person's contacts come from the directory at send time; only an address is checked here.
    if (recipient.kind === 'address') {
      if (channel === 'email' && !email.safeParse(recipient.to).success) {
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
    }
    if (!isTemplateId(template)) {
      ctx.addIssue({ code: 'custom', path: ['template'], message: 'unknown template' });
    } else {
      if (templateChannel(template) !== channel) {
        ctx.addIssue({
          code: 'custom',
          path: ['template'],
          message: `is a ${templateChannel(template)} template, not ${channel}`,
        });
      }
      for (const issue of templateParams(template).safeParse(params).error?.issues ?? []) {
        ctx.addIssue({ ...issue, path: ['params', ...issue.path] });
      }
    }
  })
  .transform(({ template, ...body }, ctx) => {
    // Narrows the type; the refinement above has already rejected unknown templates.
    if (!isTemplateId(template)) {
      ctx.addIssue({ code: 'custom', path: ['template'], message: 'unknown template' });
      return z.NEVER;
    }
    return { ...body, template };
  });

export type SendMessage = z.infer<typeof sendMessageSchema>;
