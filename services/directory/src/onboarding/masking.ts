import type { OtpChannel } from './session-state.js';

/**
 * Contact masking, with the portal's rules (`maskEmail` / `maskPhone` in
 * packages/ui/src/components/masked-contact.tsx, a React package the service cannot import):
 * the same inputs give the same output, so a contact looks the same whichever side masked it.
 */

/** `jane.doe@moe.go.ke` → `j***@moe.go.ke`: the local part's length is not revealed. */
export function maskEmail(email: string): string {
  const value = email.trim();
  const at = value.lastIndexOf('@');
  if (at < 1) return '***';
  return `${value.charAt(0)}***${value.slice(at)}`;
}

const MASKED_PHONE = /^(?:(?:\d{2}|\+\d{1,3} )\*\* \*\*\* \d{3}|\*\* \*\*\* \*\*\*)$/;
const FULLY_MASKED_PHONE = '** *** ***';
const MIN_PHONE_DIGITS = 9;
/** ITU two-digit country codes; 1 and 7 are the only one-digit ones and the rest have three. */
const TWO_DIGIT_COUNTRY_CODES = new Set(
  '20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(
    ' ',
  ),
);

function countryCodeOf(digits: string): string {
  if (digits.startsWith('1') || digits.startsWith('7')) return digits.slice(0, 1);
  const two = digits.slice(0, 2);
  return TWO_DIGIT_COUNTRY_CODES.has(two) ? two : digits.slice(0, 3);
}

/**
 * Keeps the last three digits: Kenyan numbers in the local format (`+254712345678` →
 * `07** *** 678`), others with their country code (`+44 ** *** 958`); fewer than nine digits
 * are hidden entirely.
 */
export function maskPhone(phone: string): string {
  const value = phone.trim();
  if (MASKED_PHONE.test(value)) return value;
  const international = value.startsWith('+');
  const digits = value.replace(/\D/g, '');
  if (digits.length < MIN_PHONE_DIGITS) return FULLY_MASKED_PHONE;

  const lastThree = digits.slice(-3);
  const kenyan = digits.startsWith('254') && digits.length === 12;
  if (kenyan) return `0${digits.charAt(3)}** *** ${lastThree}`;
  if (international) return `+${countryCodeOf(digits)} ** *** ${lastThree}`;
  const local = /^[17]\d{8}$/.test(digits) ? `0${digits}` : digits;
  return `${local.slice(0, 2)}** *** ${lastThree}`;
}

export function maskContact(channel: OtpChannel, value: string): string {
  return channel === 'email' ? maskEmail(value) : maskPhone(value);
}
