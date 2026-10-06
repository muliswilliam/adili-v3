import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COMMISSION_FIGURES, NATIONAL_FIGURES } from './aggregate-keys';

// The reporting service names the figures it sends the narrative task (and so the aggregate keys
// the gateway's validator accepts) in its source, not its contract, so read them from there.
const NARRATIVE_INPUT = readFileSync(
  new URL(
    '../../../../../services/reporting/src/national-reports/narrative-input.ts',
    import.meta.url,
  ),
  'utf8',
);

function serviceList(name: string): string[] {
  const block = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const;`).exec(
    NARRATIVE_INPUT,
  )?.[1];
  const names = [...(block ?? '').matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1] ?? '');
  expect(names.length, `${name} in narrative-input.ts`).toBeGreaterThan(0);
  return names;
}

describe('figure names copied from the reporting service (narrative-input.ts)', () => {
  it('names every national total and rate the service sends, and no other', () => {
    expect([...NATIONAL_FIGURES].sort()).toEqual(
      [...serviceList('NATIONAL_TOTALS'), ...serviceList('NATIONAL_RATES')].sort(),
    );
  });

  it("names every figure of a Commission's row the service sends, and no other", () => {
    expect([...COMMISSION_FIGURES].sort()).toEqual(serviceList('COMMISSION_FIGURES').sort());
  });
});
