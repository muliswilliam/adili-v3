import { randomBytes } from 'node:crypto';

/** Crockford base32: no I, L, O or U, so a code read aloud or typed by hand survives. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A fresh verification id (ADR-010): 128 random bits in Crockford base32 (26 characters, the
 * last carrying two zero bits), printed as `ADL-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX`. Random, so
 * issued documents cannot be enumerated from one code.
 */
export function newVerificationId(random: Buffer = randomBytes(16)): string {
  if (random.length !== 16) throw new Error('a verification id takes 16 random bytes');
  let bits = 0n;
  for (const byte of random) bits = (bits << 8n) | BigInt(byte);
  bits <<= 2n;
  let encoded = '';
  for (let shift = 125n; shift >= 0n; shift -= 5n) {
    encoded += ALPHABET.charAt(Number((bits >> shift) & 31n));
  }
  return `ADL-${encoded.match(/.{1,4}/g)?.join('-') ?? ''}`;
}
