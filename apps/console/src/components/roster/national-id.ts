/** What stands in for each hidden character of a national ID, as the directory masks it. */
export const MASK_CHARACTER = '•';

/** How many trailing characters a masked national ID keeps. */
const VISIBLE_CHARACTERS = 3;

/**
 * A national ID as lists show it: every character but the last three replaced, e.g.
 * `•••••123`. The directory already masks IDs in lists (`nationalIdMasked`); masking its value
 * again changes nothing, and guarantees no screen shows more than three characters even if a
 * full ID ever reached a list.
 */
export function maskNationalId(value: string): string {
  const id = value.trim();
  const visible = id.slice(-VISIBLE_CHARACTERS);
  return MASK_CHARACTER.repeat(id.length - visible.length) + visible;
}

/**
 * What a screen reader hears instead of the bullets: `masked, ends in 1 2 3`. Digits are
 * spaced so they are read one by one, not as a number.
 */
export function maskedNationalIdLabel(value: string): string {
  const ending = maskNationalId(value).replaceAll(MASK_CHARACTER, '');
  return ending ? `masked, ends in ${ending.split('').join(' ')}` : 'masked';
}
