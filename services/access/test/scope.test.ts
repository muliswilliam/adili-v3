import { describe, expect, it } from 'vitest';

import { isWithinScope, type Scope, scopeSchema } from '../src/scope.js';

const requested: Scope = {
  years: [2026, 2027],
  includeSpouses: true,
  includeChildren: false,
  sections: ['income', 'assets', 'liabilities'],
};

describe('isWithinScope', () => {
  it('admits the requested scope itself and any narrowing of it', () => {
    expect(isWithinScope(requested, requested)).toBe(true);
    expect(
      isWithinScope(
        {
          years: [2027],
          includeSpouses: false,
          includeChildren: false,
          sections: ['assets'],
        },
        requested,
      ),
    ).toBe(true);
  });

  it.each<[string, Partial<Scope>]>([
    ['another year', { years: [2025] }],
    ['another section', { sections: ['bio'] }],
    ['children the request left out', { includeChildren: true }],
  ])('refuses a grant reaching %s', (_, widening) => {
    expect(isWithinScope({ ...requested, ...widening }, requested)).toBe(false);
  });

  it('refuses spouses a request left out', () => {
    const narrow = { ...requested, includeSpouses: false };
    expect(isWithinScope({ ...narrow, includeSpouses: true }, narrow)).toBe(false);
  });
});

describe('scopeSchema', () => {
  it('has no clarifications: a scope asking for them is invalid at the scope', () => {
    const result = scopeSchema.safeParse({ ...requested, includeClarifications: false });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['includeClarifications'] }),
    ]);
  });
});
