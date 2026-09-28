import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ROSTER_API_RATE_LIMITS, ROSTER_BATCH_MAX_ROWS } from './contract';

// The generated types carry no limits or vendor extensions, so read them from the contract.
const contract = readFileSync(
  new URL('../../../node_modules/@adili/schemas/internal/directory.yaml', import.meta.url),
  'utf8',
);

/** The `limit` of every `x-rate-limit` of `group` in the contract, per 60 seconds. */
function limitsOf(group: string): string[] {
  const pattern = new RegExp(
    `x-rate-limit:\\s+group: ${group}\\s+limit: (\\d+)\\s+windowSeconds: 60\\b`,
    'g',
  );
  return [...contract.matchAll(pattern)].map((match) => match[1] ?? '');
}

describe('roster API rules copied from the directory contract', () => {
  it('rate limits every write and read route as the API documentation says', () => {
    const writes = limitsOf('roster-write');
    const reads = limitsOf('roster-read');
    expect(writes.length).toBeGreaterThan(0);
    expect(reads.length).toBeGreaterThan(0);
    expect(new Set(writes)).toEqual(new Set([String(ROSTER_API_RATE_LIMITS.write)]));
    expect(new Set(reads)).toEqual(new Set([String(ROSTER_API_RATE_LIMITS.read)]));
  });

  it('caps a batch at the documented number of rows', () => {
    const batch = /StartBatchImport:[\s\S]*?rows:\s+minItems: 1\s+maxItems: (\d+)/.exec(contract);
    expect(batch?.[1]).toBe(String(ROSTER_BATCH_MAX_ROWS));
  });
});
