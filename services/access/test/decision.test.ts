import { describe, expect, it } from 'vitest';

import { type DecisionInput, decisionInputSchema, decisionOf } from '../src/decision.js';
import type { Scope } from '../src/scope.js';

/** The decision rules (S6): which outcome needs grounds or a narrowed scope. */
describe('decisionOf', () => {
  const requested: Scope = {
    years: [2025, 2026],
    includeSpouses: true,
    includeChildren: false,
    sections: ['income', 'assets', 'liabilities'],
    includeClarifications: true,
  };
  const narrowed: Scope = { ...requested, years: [2026], includeSpouses: false };
  const decidedBy = { subject: 'officer-psc', name: 'Peter Access' };
  const at = new Date('2027-04-01T07:00:00.000Z');
  const decide = (input: Omit<DecisionInput, 'reasons'>) =>
    decisionOf({ reasons: 'Legitimate interest shown.', ...input }, requested, decidedBy, at);

  it('S6: a grant is of the requested scope and cites no grounds', () => {
    expect(decide({ outcome: 'grant' })).toEqual({
      outcome: 'grant',
      grantedScope: requested,
      grounds: [],
      reasons: 'Legitimate interest shown.',
      decidedBy,
      decidedAt: '2027-04-01T07:00:00.000Z',
    });
    // The requested scope sent back, in any order, is the requested scope.
    expect(
      decide({ outcome: 'grant', grantedScope: { ...requested, years: [2026, 2025] } }),
    ).toMatchObject({ grantedScope: requested });
  });

  it('a grant of a narrower scope is a partial grant; with grounds it is refused', () => {
    expect(decide({ outcome: 'grant', grantedScope: narrowed })).toMatchObject({
      code: null,
      path: 'grantedScope',
    });
    expect(decide({ outcome: 'grant', grounds: ['public-interest'] })).toMatchObject({
      code: null,
      path: 'grounds',
    });
  });

  it('S6: a partial grant narrows the scope and cites grounds', () => {
    expect(
      decide({ outcome: 'partial-grant', grantedScope: narrowed, grounds: ['public-interest'] }),
    ).toMatchObject({
      outcome: 'partial-grant',
      grantedScope: narrowed,
      grounds: ['public-interest'],
    });
  });

  it('a partial grant without grounds is grounds-required; without a scope, or of the whole, 400', () => {
    expect(decide({ outcome: 'partial-grant', grantedScope: narrowed })).toMatchObject({
      code: 'grounds-required',
      path: 'grounds',
    });
    expect(decide({ outcome: 'partial-grant', grounds: ['public-interest'] })).toMatchObject({
      code: null,
      path: 'grantedScope',
    });
    expect(
      decide({ outcome: 'partial-grant', grantedScope: requested, grounds: ['public-interest'] }),
    ).toMatchObject({ code: null, path: 'grantedScope' });
  });

  it.each<[string, Partial<Scope>]>([
    ['a year', { years: [2027] }],
    ['a section', { sections: ['bio'] }],
    ['the children', { includeChildren: true }],
  ])('a scope with %s the request did not ask for exceeds it', (_, wider) => {
    expect(
      decide({
        outcome: 'partial-grant',
        grantedScope: { ...narrowed, ...wider },
        grounds: ['public-interest'],
      }),
    ).toMatchObject({ code: 'scope-exceeds-request', path: 'grantedScope' });
    expect(decide({ outcome: 'grant', grantedScope: { ...requested, ...wider } })).toMatchObject({
      code: 'scope-exceeds-request',
    });
  });

  it('S6: a denial cites grounds and grants nothing', () => {
    expect(decide({ outcome: 'deny', grounds: ['frivolous-vexatious'] })).toMatchObject({
      outcome: 'deny',
      grantedScope: null,
      grounds: ['frivolous-vexatious'],
    });
    expect(decide({ outcome: 'deny' })).toMatchObject({
      code: 'grounds-required',
      path: 'grounds',
    });
    expect(decide({ outcome: 'deny', grounds: [] })).toMatchObject({ code: 'grounds-required' });
    expect(
      decide({ outcome: 'deny', grantedScope: narrowed, grounds: ['frivolous-vexatious'] }),
    ).toMatchObject({ code: null, path: 'grantedScope' });
  });

  it('the body: reasons always, trimmed; grounds once each; nothing else', () => {
    const parse = (body: unknown) => decisionInputSchema.safeParse(body).success;
    expect(parse({ outcome: 'deny', grounds: ['public-interest'], reasons: 'Abuse.' })).toBe(true);
    expect(parse({ outcome: 'deny', grounds: ['public-interest'], reasons: '   ' })).toBe(false);
    expect(parse({ outcome: 'deny', grounds: ['public-interest'] })).toBe(false);
    expect(
      parse({ outcome: 'deny', grounds: ['public-interest', 'public-interest'], reasons: 'x' }),
    ).toBe(false);
    expect(parse({ outcome: 'deny', grounds: ['other'], reasons: 'x' })).toBe(false);
    expect(parse({ outcome: 'grant', reasons: 'x', note: 'extra' })).toBe(false);
  });
});
