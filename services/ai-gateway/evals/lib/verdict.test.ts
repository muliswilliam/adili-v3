import { describe, expect, it } from 'vitest';

import { verdictTerms } from './verdict.js';

describe('verdictTerms', () => {
  it('finds statements of a compliance determination', () => {
    expect(verdictTerms('The declarant is non-compliant with the Act.')).toEqual(['non-compliant']);
    expect(verdictTerms('He failed to comply and made a false declaration.')).toEqual([
      'failed to comply',
      'false declaration',
    ]);
    expect(verdictTerms('The declaration is fully compliant.')).toEqual(['is fully compliant']);
    expect(verdictTerms('The declarant is non compliant.')).toEqual(['non compliant']);
  });

  it('finds positive determinations', () => {
    expect(verdictTerms('The declarant has complied with the Act.')).toEqual(['has complied with']);
    expect(verdictTerms('The declarant complied with all requirements.')).toEqual([
      'complied with',
    ]);
    expect(verdictTerms('The declarant has not complied with the Act.')).toEqual([
      'has not complied',
    ]);
  });

  it('finds wrongdoing, administrative action and referral language', () => {
    expect(verdictTerms('This suggests corruption and illicit enrichment.')).toEqual([
      'corruption',
      'illicit',
    ]);
    expect(verdictTerms('The officer should be sanctioned.')).toEqual(['sanctioned']);
    expect(verdictTerms('Refer the matter to EACC for prosecution.')).toEqual([
      'refer the matter to eacc',
      'prosecution',
    ]);
  });

  it('finds the Swahili terms', () => {
    expect(verdictTerms('Mtangazaji hakutii sheria na kuna rushwa.')).toEqual([
      'hakutii sheria',
      'rushwa',
    ]);
    expect(verdictTerms('Apewe adhabu.')).toEqual(['adhabu']);
  });

  it('allows negated mentions, which the prompts ask for', () => {
    expect(verdictTerms('This is an indicator to check, not a finding of wrongdoing.')).toEqual([]);
    expect(verdictTerms('It does not mean the declarant is non-compliant.')).toEqual([]);
    expect(verdictTerms('Hii si ishara ya rushwa.')).toEqual([]);
    expect(verdictTerms('An indicator to check rather than a finding of wrongdoing.')).toEqual([]);
    expect(verdictTerms('The officer should not be sanctioned on this alone.')).toEqual([]);
    expect(verdictTerms('Haimaanishi kuna rushwa.')).toEqual([]);
    expect(verdictTerms('An indicator for review, not evidence of any wrongdoing.')).toEqual([]);
    expect(verdictTerms('It does not by itself suggest any wrongdoing.')).toEqual([]);
  });

  it('flags a term when a negation in its clause does not govern it', () => {
    expect(verdictTerms('There is no doubt the declarant is corrupt.')).toEqual(['corrupt']);
    expect(verdictTerms('The officer did not disclose the illicit income.')).toEqual(['illicit']);
  });

  it('does not let a negation reach across a clause or sentence', () => {
    expect(verdictTerms('He has not declared the vehicle; non-compliant.')).toEqual([
      'non-compliant',
    ]);
    expect(verdictTerms('Do not ignore: the declarant is corrupt.')).toEqual(['corrupt']);
    expect(verdictTerms('Nothing was missing. Corruption is likely.')).toEqual(['corruption']);
  });

  it('allows neutral review words', () => {
    expect(
      verdictTerms(
        'Ask the declarant to explain the discrepancy and provide the logbook; the reviewer decides. The vehicle may have been concealed by a typo.',
      ),
    ).toEqual([]);
  });
});
