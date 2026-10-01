import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { z } from 'zod';

/**
 * How roster identifiers and contacts are normalised, wherever they come from: imported rows
 * (`row-validation.ts`, `apply-chunk.ts`) and what a declarant types at onboarding, so both
 * compare alike.
 */

/** Longest email address accepted (RFC 5321 path limit). */
export const EMAIL_MAX_LENGTH = 254;
/** Longest phone number accepted as typed, before normalisation. */
export const PHONE_MAX_LENGTH = 20;

const EMAIL = z.email();

/**
 * The key personnel file numbers are identified by within a Commission: trimmed and lower-cased
 * (the roster's unique index is on `lower(personnel_file_number)`).
 */
export function fileNumberKey(fileNumber: string): string {
  return fileNumber.trim().toLowerCase();
}

/** A national ID as the roster stores it: digits, whitespace removed. */
export function normaliseNationalId(value: string): string {
  return value.replace(/\s+/g, '');
}

/** An email trimmed and lower-cased, or null when that is not a valid address of at most 254. */
export function normaliseEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= EMAIL_MAX_LENGTH && EMAIL.safeParse(email).success ? email : null;
}

/**
 * A phone number in E.164, Kenya being the default country, or null when it is not a valid one
 * (or longer than 20 characters as typed).
 */
export function normalisePhone(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > PHONE_MAX_LENGTH) return null;
  const parsed = parsePhoneNumberFromString(trimmed, 'KE');
  return parsed?.isValid() ? parsed.number : null;
}
