import { z } from 'zod';

import type { OtpChannel } from '../../server/directory/types';

export const CONTACT_ERRORS = {
  email: 'Enter an email address in the format name@example.com.',
  phone: 'Enter a Kenyan mobile number, e.g. 0712 345 678.',
} as const;

/**
 * A Kenyan mobile number in E.164, or null when it cannot be one. It may be written locally
 * (`0712 345 678`) or with the country code (`254712345678`, `+254 712 345 678`). SMS codes go
 * to Kenyan numbers only.
 */
export function normalisePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, '');
  const kenyan = /^(?:\+?254|0)([17]\d{8})$/.exec(compact);
  return kenyan ? `+254${kenyan[1] ?? ''}` : null;
}

const emailValue = z.string().trim().pipe(z.email(CONTACT_ERRORS.email).max(254));

const phoneValue = z.string().transform((value, context) => {
  const phone = normalisePhone(value);
  if (phone === null) {
    context.addIssue({ code: 'custom', message: CONTACT_ERRORS.phone });
    return z.NEVER;
  }
  return phone;
});

/** A contact the declarant supplies, checked in the browser and again in the server function. */
export const contactSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('email'), value: emailValue }),
  z.object({ channel: z.literal('phone'), value: phoneValue }),
]);

export type ContactInput = z.input<typeof contactSchema>;

/** The error for a contact field, or null when it is valid. */
export function contactError(channel: OtpChannel, value: string): string | null {
  const result = contactSchema.safeParse({ channel, value });
  return result.success ? null : (result.error.issues[0]?.message ?? CONTACT_ERRORS[channel]);
}

export const codeSchema = z.object({
  channel: z.enum(['email', 'phone']),
  code: z.string().regex(/^\d{6}$/),
});

export const channelSchema = z.object({ channel: z.enum(['email', 'phone']) });
