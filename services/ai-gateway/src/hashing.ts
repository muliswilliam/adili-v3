import { createHash } from 'node:crypto';

import { canonicalJson } from '@adili/api-kit';

/** SHA-256 (hex) of the canonical JSON of `value`: equal values hash equally. */
export function hashJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
