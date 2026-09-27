/** Characters a reference may contain besides the hyphen separators, in value order. */
export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const MODULUS = ALPHABET.length;

const HYPHEN = '-'.charCodeAt(0);

/** Character code to value, -1 outside the alphabet. */
const VALUES = new Int8Array(128).fill(-1);
for (let value = 0; value < MODULUS; value++) VALUES[ALPHABET.charCodeAt(value)] = value;

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
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code === HYPHEN) continue;
    const value = code < 128 ? (VALUES[code] ?? -1) : -1;
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
