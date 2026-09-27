import { E164_PATTERN } from '../../server/directory/contract';

const KENYA = '+254';

/**
 * A phone number as typed, in E.164 with Kenya as the default region, or null when it cannot be
 * one (spec 01, S20). Accepts local Kenyan numbers (`0712 345 678`, `0110 123 456`, `712345678`),
 * `254…` without the plus, and international numbers with `+` or `00`. Spaces, dashes, dots and
 * brackets are ignored.
 */
export function normalisePhone(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits === '') return null;
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith('+')) {
    const local = /^(?:0|254)?([17]\d{8})$/.exec(digits)?.[1];
    if (!local) return null;
    digits = `${KENYA}${local}`;
  }
  if (!E164_PATTERN.test(digits)) return null;
  // Kenyan numbers have exactly nine digits after the country code.
  if (digits.startsWith(KENYA) && digits.length !== KENYA.length + 9) return null;
  return digits;
}

/** An E.164 number grouped for reading: `+254 712 345 678`; other countries as stored. */
export function formatPhone(e164: string): string {
  const kenyan = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return kenyan ? `${KENYA} ${kenyan[1]} ${kenyan[2]} ${kenyan[3]}` : e164;
}
