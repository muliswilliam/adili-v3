import type { ContactChannel } from './channels.js';

/**
 * `jane.doe@moe.go.ke` → `j***@moe.go.ke`. The local part always becomes three stars, so its
 * length is not revealed. Masking an already masked value gives the same value back, so there
 * is no pass-through: a value such as `a*b@moe.go.ke` is masked like any other.
 */
export function maskEmail(email: string): string {
  const value = email.trim();
  const at = value.lastIndexOf('@');
  if (at < 1) return '***';
  return `${value.charAt(0)}***${value.slice(at)}`;
}

/** The only shapes maskPhone produces. Anything else is treated as a full number. */
const MASKED_PHONE =
  /^(?:(?:\d{2}|\+\d{1,3} )\*\* \*\*\* \d{3}|(?:\+\d{1,3} )?\*\* \*\*\* \*\*\*)$/;
const FULLY_MASKED_PHONE = '** *** ***';
/** Fewer digits than this are hidden entirely, so a short value never shows most of itself. */
const MIN_PHONE_DIGITS = 9;
/**
 * An international number whose national part (the digits after the country code) is shorter
 * than this keeps only its country code. At eight or more, the three digits shown are always
 * less than half of the national number.
 */
const MIN_NATIONAL_DIGITS = 8;
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
 * Masks a phone number, keeping the last three digits.
 *
 * - Kenyan numbers (`+254712345678`, `254712345678`, `0712 345 678`, `712345678`) are shown in
 *   the local format: `07** *** 678`.
 * - Other international numbers keep their country code: `+44 20 7946 0958` → `+44 ** *** 958`.
 *   When the national part (after the country code) has fewer than eight digits, it is hidden
 *   entirely: `+504038659` → `+504 ** *** ***`.
 * - Values with fewer than nine digits are hidden entirely (`** *** ***`) rather than showing
 *   most of a short number.
 *
 * Only the exact shapes above pass through unchanged; any other value, even one that contains a
 * star, is masked, so the full number is never returned.
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
  if (international) {
    const countryCode = countryCodeOf(digits);
    const nationalDigits = digits.length - countryCode.length;
    const shown = nationalDigits < MIN_NATIONAL_DIGITS ? '***' : lastThree;
    return `+${countryCode} ** *** ${shown}`;
  }
  // A Kenyan mobile typed without its leading zero, e.g. 712345678.
  const local = /^[17]\d{8}$/.test(digits) ? `0${digits}` : digits;
  return `${local.slice(0, 2)}** *** ${lastThree}`;
}

const MASKS: Record<ContactChannel, (value: string) => string> = {
  email: maskEmail,
  phone: maskPhone,
};

/** A contact of `channel`, masked by that channel's rule. */
export function maskContact(channel: ContactChannel, value: string): string {
  return MASKS[channel](value);
}
