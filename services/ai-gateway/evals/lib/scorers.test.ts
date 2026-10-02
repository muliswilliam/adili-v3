import { describe, expect, it } from 'vitest';

import { languageMatches, noForeignNumbers, noVerdict, withinBudget } from './scorers.js';
import { softResults } from './score.js';

const ITEM = '0192f1a0-5a11-7000-8000-000000002001';
const output = {
  overview: 'One plot valued at KES 18,000,000.',
  sections: [{ sectionKey: 'statement:officer', text: 'A plot.', refs: [] }],
  worthAttention: [{ text: 'Check the basis of the valuation.', flagIds: [ITEM] }],
};

describe('shared scorers', () => {
  it('pass a clean output and skip refs and ids', () => {
    const input = { value: { kesCents: 1_800_000_000 } };
    expect(noForeignNumbers(output, input)).toMatchObject({ score: 1, failures: [] });
    expect(noVerdict(output)).toMatchObject({ score: 1, failures: [] });
  });

  it('name the field and the offending text', () => {
    const tampered = { ...output, overview: 'The declarant is non-compliant; assets of KES 20m.' };
    expect(noForeignNumbers(tampered, {}).failures).toEqual([
      '/overview: 20m is not in the input ("The declarant is non-compliant; assets of KES 20m.")',
    ]);
    expect(noVerdict(tampered)).toMatchObject({
      hard: true,
      score: 0,
      failures: ['/overview: "non-compliant"'],
    });
  });

  it('score language over fields long enough to tell', () => {
    const swahili = {
      overview:
        'Tamko hili ni la mtumishi ambaye ana mali katika Kenya na pia akaunti ya akiba nje ya nchi tangu mwaka uliopita.',
      sections: [{ text: 'Short.' }],
    };
    expect(languageMatches(swahili, 'sw').score).toBe(1);
    expect(languageMatches(swahili, 'en')).toMatchObject({ score: 0, hard: false });
  });

  it('score brevity per budgeted field', () => {
    const budgets = [
      { path: '/overview', maxWords: 4 },
      { path: '/sections/*/text', maxWords: 5 },
    ];
    expect(withinBudget(output, budgets)).toMatchObject({
      score: 0.5,
      failures: ['/overview: 5 words, budget 1-4'],
    });
  });
});

describe('softResults', () => {
  it('averages each soft scorer over the cases against its threshold', () => {
    const results = [
      { caseName: 'a', scores: [{ scorer: 'language', hard: false, score: 1, failures: [] }] },
      { caseName: 'b', scores: [{ scorer: 'language', hard: false, score: 0.6, failures: [] }] },
    ];
    expect(softResults(results, { language: 0.9 })).toEqual([
      { scorer: 'language', mean: 0.8, threshold: 0.9, passed: false },
    ]);
  });
});
