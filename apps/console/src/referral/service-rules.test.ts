import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ASSET_RULE_LABELS, NARRATIVE_EXCERPT } from './view';

// Review does not publish these in its contract, so read them from its source.
const source = (file: string) =>
  readFileSync(
    new URL(`../../../../services/review/src/referrals/${file}`, import.meta.url),
    'utf8',
  );

describe('referral rules copied from the review service', () => {
  it('labels exactly the flag rules review accepts for an assets referral (ASSET_RULES)', () => {
    const block = /export const ASSET_RULES[^=]*= new Set\(\[([^\]]*)\]\)/.exec(
      source('referrals.service.ts'),
    )?.[1];
    expect(block).toBeDefined();
    const rules = [...(block ?? '').matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
    expect(rules.length).toBeGreaterThan(0);
    expect(Object.keys(ASSET_RULE_LABELS).sort()).toEqual(rules.sort());
  });

  it('cuts the inbox narrative where review does (NARRATIVE_EXCERPT)', () => {
    const value = /const NARRATIVE_EXCERPT = (\d+);/.exec(source('referral-approvals.ts'))?.[1];
    expect(Number(value)).toBe(NARRATIVE_EXCERPT);
  });
});
