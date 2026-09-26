/** Characters a reference may contain besides the hyphen separators, in value order. */
export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const MODULUS = ALPHABET.length;

/**
 * ISO 7064 hybrid MOD 37-36 check character over `input` (ADR-011). Hyphens are separators
 * and are skipped; any other character outside 0-9 and A-Z is a `RangeError`.
 */
export function checkCharacter(input: string): string {
  const state = checksum(input, 'input');
  return ALPHABET.charAt((MODULUS + 1 - (((state || MODULUS) * 2) % (MODULUS + 1))) % MODULUS);
}

/** Whether the last character of `reference` is the check character of the rest. */
export function hasValidCheckCharacter(reference: string): boolean {
  try {
    return checksum(reference, 'reference') === 1;
  } catch {
    return false;
  }
}

function checksum(input: string, label: string): number {
  let state = MODULUS / 2;
  let characters = 0;
  for (const char of input) {
    if (char === '-') continue;
    const value = ALPHABET.indexOf(char);
    if (value < 0) {
      throw new RangeError(`${label} may only contain 0-9, A-Z and hyphens`);
    }
    state = ((((state || MODULUS) * 2) % (MODULUS + 1)) + value) % MODULUS;
    characters++;
  }
  if (characters === 0) {
    throw new RangeError(`${label} is empty`);
  }
  return state;
}
