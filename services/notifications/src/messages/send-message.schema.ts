import { z } from 'zod';

import {
  CHANNELS,
  isTemplateId,
  LOCALES,
  TEMPLATE_IDS,
  templateChannel,
  templateParams,
} from './templates.js';

// ITU-T E.164: a plus, a country code that never starts with 0, at most 15 digits.
const E164 = /^\+[1-9]\d{7,14}$/;
const email = z.email();

export const channelSchema = z.enum(CHANNELS);

export const templateIdSchema = z
  .enum(TEMPLATE_IDS)
  .meta({ description: 'Registered templates; each declares its params' });

export const recipientSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('address'),
    to: z
      .string()
      .trim()
      .min(1)
      .max(254)
      .meta({ description: 'Email address or E.164 phone number, matching the channel' }),
  }),
  z.object({
    kind: z.literal('person'),
    personId: z.uuid().meta({
      description:
        'Contacts resolved through the directory. Not supported yet: rejected with 400 until the directory serves contacts',
    }),
  }),
]);

/** `SendMessage`: body of `POST /internal/v1/messages` as the contract states it. */
export const sendMessageBody = z.object({
  channel: channelSchema,
  recipient: recipientSchema,
  template: templateIdSchema,
  params: z
    .record(z.string(), z.unknown())
    .meta({ description: "Validated against the template's parameter schema" }),
  locale: z.enum(LOCALES).default('en'),
  tenant: z.string().min(1).max(64).optional().meta({
    description: 'Tenant key for audit and per-tenant branding; optional for platform messages',
  }),
});

/**
 * Validates `POST /internal/v1/messages`. The template is first taken as any string so that an
 * unknown one is reported together with the recipient and params errors.
 */
export const sendMessageSchema = sendMessageBody
  .extend({ template: z.string().min(1) })
  // One pass, so a caller sees every recipient, template and params error in one response.
  .superRefine((body, ctx) => {
    const { channel, recipient, template, params } = body;
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
