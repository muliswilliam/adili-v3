import { describe, expect, it } from 'vitest';

import { isWithinScope, type Scope, scopeSchema } from '../src/scope.js';

const requested: Scope = {
  years: [2026, 2027],
  includeSpouses: true,
  includeChildren: false,
  sections: ['income', 'assets', 'liabilities'],
  includeClarifications: true,
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
          includeClarifications: false,
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

  it('refuses clarifications or spouses a request left out', () => {
    const narrow = { ...requested, includeSpouses: false, includeClarifications: false };
    expect(isWithinScope({ ...narrow, includeSpouses: true }, narrow)).toBe(false);
    expect(isWithinScope({ ...narrow, includeClarifications: true }, narrow)).toBe(false);
  });
});

describe('scopeSchema', () => {
  it('needs clarifications said yes or no, and takes no other field', () => {
    const withoutClarifications: Partial<Scope> = { ...requested };
    delete withoutClarifications.includeClarifications;
    expect(scopeSchema.safeParse(requested).success).toBe(true);
    expect(scopeSchema.safeParse(withoutClarifications).error?.issues).toEqual([
      expect.objectContaining({ path: ['includeClarifications'] }),
    ]);
    expect(scopeSchema.safeParse({ ...requested, clarifications: true }).error?.issues).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['clarifications'] }),
    ]);
  });
});
