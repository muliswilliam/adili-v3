/*
 * The verification code field on the index: the `ADL-` prefix sits outside the input, and what
 * is typed or pasted is shaped into the printed groups as it arrives (uppercase, Crockford
 * look-alikes read as digits, groups of four). What the lookup accepts is decided by
 * `normalizeVerificationId` from @adili/events/contracts, the same function the services use.
 */

/** Base32 characters in a verification id, after the `ADL-` prefix. */
export const CODE_LENGTH = 26;

const GROUP = 4;

function significant(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

function grouped(body: string): string {
  return (body.match(/.{1,4}/g) ?? []).join('-');
}

/** Where the caret goes after `count` characters of the grouped value. */
function caretAfter(count: number): number {
  return count === 0 ? 0 : count + Math.floor((count - 1) / GROUP);
}

/**
 * Shapes the field's raw value into grouped code characters, dropping a pasted `ADL` prefix and
 * anything past the 26th character, and moves the caret to the same character it was after.
 * `7q4k m2xr` → `7Q4K-M2XR`; `adl-7q4k-...` → `7Q4K-...`.
 */
export function formatCodeInput(raw: string, caret = raw.length): { value: string; caret: number } {
  const all = significant(raw);
  // A code never starts with ADL (L is not a code character), so a leading ADL is the prefix.
  const prefixed = /^ADL/i.test(raw.replace(/[^0-9A-Za-z]/g, ''));
  const skip = prefixed ? 3 : 0;
  const body = all.slice(skip, skip + CODE_LENGTH);
  const before = Math.min(Math.max(significant(raw.slice(0, caret)).length - skip, 0), body.length);
  return { value: grouped(body), caret: caretAfter(before) };
}

/** The full code for the lookup: the prefix and the field's value. */
export function codeFromInput(value: string): string {
  return `ADL-${value}`;
}
