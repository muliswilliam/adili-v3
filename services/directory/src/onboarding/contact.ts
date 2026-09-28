import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { z } from 'zod';

/**
 * Normalising the contacts a declarant supplies at onboarding the way roster imports normalise
 * the roster's (`row-validation.ts`), so both compare alike: email trimmed and lower-cased, phone
 * in E.164 with Kenya as the default country. Null when the value is not a valid one.
 */

const EMAIL = z.email();

export function normaliseEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.safeParse(email).success ? email : null;
}

export function normalisePhone(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > 20) return null;
  const parsed = parsePhoneNumberFromString(trimmed, 'KE');
  return parsed?.isValid() ? parsed.number : null;
}
