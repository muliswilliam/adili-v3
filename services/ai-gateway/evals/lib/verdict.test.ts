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

  it('finds a negative determination stated with comply or compliant', () => {
    expect(verdictTerms('The declarant does not comply with section 31(4).')).toEqual([
      'does not comply',
    ]);
    expect(verdictTerms('This declaration fails to comply with section 31.')).toEqual([
      'fails to comply',
    ]);
    expect(verdictTerms('The declaration is not fully compliant with the Act.')).toEqual([
      'not fully compliant',
    ]);
    expect(verdictTerms('The declarant is not in compliance with the Act.')).toEqual([
      'not in compliance',
    ]);
    expect(verdictTerms('The declarant did not fully comply with the requirement.')).toEqual([
      'did not fully comply',
    ]);
    expect(verdictTerms('The declarant had not complied with the deadline.')).toEqual([
      'had not complied',
    ]);
    expect(verdictTerms('The declarant never complied with the notice.')).toEqual([
      'never complied',
    ]);
    expect(
      verdictTerms('The declarant failed to declare the land and does not comply with the Act.'),
    ).toEqual(['does not comply']);
  });

  it('finds a breach or violation stated as a noun or in the present tense', () => {
    expect(verdictTerms('Omitting the vehicle is a breach of section 31.')).toEqual([
      'a breach of',
    ]);
    expect(verdictTerms('This constitutes a breach of the Act.')).toEqual(['a breach of']);
    expect(verdictTerms('The omission violates section 31 of the Act.')).toEqual(['violates']);
    expect(
      verdictTerms('The declarant failed to declare the vehicle, which is a breach of the Act.'),
    ).toEqual(['a breach of']);
  });

  it('finds positive determinations', () => {
    expect(verdictTerms('The declarant has complied with the Act.')).toEqual(['has complied with']);
    expect(verdictTerms('The declarant complied with all requirements.')).toEqual([
      'complied with',
    ]);
    expect(verdictTerms('The declarant has not complied with the Act.')).toEqual([
      'has not complied',
    ]);
    expect(verdictTerms('The declarant appears compliant with the Act.')).toEqual([
      'appears compliant',
    ]);
    expect(verdictTerms('The declarant seems to be fully compliant.')).toEqual([
      'seems to be fully compliant',
    ]);
  });

  it('allows a check instruction that names a positive determination', () => {
    expect(verdictTerms('Check whether the declarant complied with the deadline.')).toEqual([]);
    expect(verdictTerms('Confirm whether the declarant complied with the deadline.')).toEqual([]);
    expect(verdictTerms('Confirm if the declaration is compliant.')).toEqual([]);
    expect(verdictTerms('Check whether the declarant did not comply with the notice.')).toEqual([]);
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
    expect(verdictTerms('Recommend referral to the EACC.')).toEqual(['referral to the eacc']);
  });

  it('finds non-compliance, contravention and administrative action under the Act', () => {
    expect(verdictTerms('This amounts to non-compliance with section 31 of the Act.')).toEqual([
      'non-compliance',
    ]);
    expect(verdictTerms('The declarant contravened section 26.')).toEqual(['contravened']);
    expect(verdictTerms('Omitting the vehicle is a contravention of the Act.')).toEqual([
      'contravention',
    ]);
    expect(verdictTerms('This is a failure to comply with the filing deadline.')).toEqual([
      'failure to comply',
    ]);
    expect(
      verdictTerms('The reviewer should recommend administrative action against the officer.'),
    ).toEqual(['administrative action']);
    expect(verdictTerms('Issue a notice to comply.')).toEqual(['notice to comply']);
  });

  it('allows these terms when denied', () => {
    expect(verdictTerms('This is an indicator, not a finding of non-compliance.')).toEqual([]);
    expect(verdictTerms('It does not mean the declarant contravened section 26.')).toEqual([]);
    expect(verdictTerms('A late filing is not by itself a failure to comply.')).toEqual([]);
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
    expect(verdictTerms('This does not mean that there was any wrongdoing.')).toEqual([]);
    expect(verdictTerms('This flag does not constitute a breach of the Act.')).toEqual([]);
  });

  it('finds a breach of the Act denied only by a bare negation, which decides compliance', () => {
    expect(verdictTerms('The declarant is not in breach of the Act.')).toEqual(['in breach of']);
    expect(verdictTerms('Omitting the vehicle is not a breach of section 31.')).toEqual([
      'a breach of',
    ]);
    expect(verdictTerms('The declarant has not contravened the Act.')).toEqual(['contravened']);
    expect(verdictTerms('There is no breach of the Act.')).toEqual(['breach of']);
    expect(verdictTerms('The declarant has not violated section 26.')).toEqual(['violated']);
    expect(verdictTerms('There was no non-compliance with the Act.')).toEqual(['non-compliance']);
    expect(verdictTerms('The declarant is not corrupt or in breach of the Act.')).toEqual([
      'in breach of',
    ]);
    expect(verdictTerms('Hakuna ukiukaji wa sheria.')).toEqual(['ukiukaji']);
  });

  it('allows a breach of the Act denied by a denied noun, hedge or inference', () => {
    expect(verdictTerms('This is not a finding of a breach of the Act.')).toEqual([]);
    expect(verdictTerms('This is not evidence of non-compliance.')).toEqual([]);
    expect(verdictTerms('It does not mean the declarant is in breach of the Act.')).toEqual([]);
    expect(verdictTerms('This should not be read as a breach of the Act.')).toEqual([]);
    expect(verdictTerms('This is not evidence of fraud or a breach of the Act.')).toEqual([]);
    expect(verdictTerms('Hii si ishara ya ukiukaji.')).toEqual([]);
  });

  it('lets a denied noun or inference reach over "that" to the term', () => {
    expect(
      verdictTerms('This flag alone is not evidence that the declarant is dishonest.'),
    ).toEqual([]);
    expect(
      verdictTerms('Do not conclude from this flag alone that the declarant is non-compliant.'),
    ).toEqual([]);
    expect(verdictTerms('Do not assume the declarant is corrupt.')).toEqual([]);
    expect(verdictTerms('There is no indication that any funds were illicit.')).toEqual([]);
  });

  it('lets a denial cover a term coordinated with the denied one', () => {
    expect(verdictTerms('This does not mean the declarant was dishonest or corrupt.')).toEqual([]);
    expect(
      verdictTerms('This does not mean the declarant acted dishonestly or corruptly.'),
    ).toEqual([]);
    expect(verdictTerms('This is not evidence of corruption or fraud.')).toEqual([]);
  });

  it('lets a denial govern a negative determination', () => {
    expect(verdictTerms('This does not mean the declarant does not comply.')).toEqual([]);
    expect(verdictTerms('This is not a finding that the declarant is not compliant.')).toEqual([]);
  });

  it('lets "nothing", "no part of" and "not be read as" deny the term', () => {
    expect(verdictTerms('Nothing in the flag itself suggests wrongdoing.')).toEqual([]);
    expect(verdictTerms('No part of this flag indicates wrongdoing.')).toEqual([]);
    expect(verdictTerms('This indicator should not be read as a finding of wrongdoing.')).toEqual(
      [],
    );
    expect(verdictTerms('Nothing suggests otherwise: the declarant is corrupt.')).toEqual([
      'corrupt',
    ]);
  });

  it('allows paraphrases of "not a finding of wrongdoing"', () => {
    expect(verdictTerms('This should not be interpreted as a finding of wrongdoing.')).toEqual([]);
    expect(verdictTerms('This does not necessarily point to wrongdoing.')).toEqual([]);
    expect(verdictTerms('Nothing in the flag itself points to wrongdoing.')).toEqual([]);
    expect(verdictTerms('This is not a conclusion of wrongdoing.')).toEqual([]);
    expect(verdictTerms('This is not an accusation of wrongdoing.')).toEqual([]);
    expect(verdictTerms('The flag is not a judgment of wrongdoing.')).toEqual([]);
  });

  it('lets a denial reach over a hedge set off by commas', () => {
    expect(verdictTerms('This is not, by itself, evidence of wrongdoing.')).toEqual([]);
    expect(verdictTerms('It does not, on its own, suggest wrongdoing.')).toEqual([]);
  });

  it('flags a term when a negation in its clause does not govern it', () => {
    expect(verdictTerms('There is no doubt the declarant is corrupt.')).toEqual(['corrupt']);
    expect(verdictTerms('There is no doubt that the declarant is corrupt.')).toEqual(['corrupt']);
    expect(
      verdictTerms(
        'The declarant did not show the loan, and there is evidence that he is dishonest.',
      ),
    ).toEqual(['dishonest']);
    expect(verdictTerms('The officer did not disclose the illicit income.')).toEqual(['illicit']);
    expect(
      verdictTerms('The declarant did not indicate the source and is in breach of s.31.'),
    ).toEqual(['in breach of']);
    expect(verdictTerms('The declarant did not show the loan and is non-compliant.')).toEqual([
      'non-compliant',
    ]);
  });

  it('flags a term in the object of a denied finding or after an exception', () => {
    expect(verdictTerms('This does not show anything other than fraud.')).toEqual(['fraud']);
    expect(verdictTerms('This does not mean anything other than fraud.')).toEqual(['fraud']);
    expect(verdictTerms('The declaration does not show the source of the illicit income.')).toEqual(
      ['illicit'],
    );
    expect(
      verdictTerms('The records do not establish the origin of the corrupt payments.'),
    ).toEqual(['corrupt']);
  });

  it('lets a denied finding reach the term directly or over "that"', () => {
    expect(verdictTerms('This does not show that the declarant is corrupt.')).toEqual([]);
    expect(verdictTerms('This does not indicate any wrongdoing.')).toEqual([]);
  });

  it('lets a denied finding reach the term over a denied noun', () => {
    expect(verdictTerms('This flag does not constitute a finding of wrongdoing.')).toEqual([]);
    expect(verdictTerms('This flag does not amount to an allegation of corruption.')).toEqual([]);
    expect(verdictTerms('The gap does not indicate evidence of fraud.')).toEqual([]);
    expect(verdictTerms('This does not establish a determination of non-compliance.')).toEqual([]);
    expect(verdictTerms('This does not indicate any sign of wrongdoing.')).toEqual([]);
  });

  it('flags a term after a denied finding over a definite denied noun, which presupposes it', () => {
    expect(verdictTerms('The declarant did not show the proof of the illicit income.')).toEqual([
      'illicit',
    ]);
    expect(verdictTerms('The declarant did not establish the case of fraud.')).toEqual(['fraud']);
  });

  it('lets a denied inference or denied noun reach a term over a perfect', () => {
    expect(verdictTerms('This does not mean the declarant has breached the Act.')).toEqual([]);
    expect(verdictTerms('This does not mean the declarant has contravened the Act.')).toEqual([]);
    expect(
      verdictTerms('This flag does not by itself mean the declarant has violated section 26.'),
    ).toEqual([]);
    expect(
      verdictTerms('This does not mean the declarant has failed to comply with the Act.'),
    ).toEqual([]);
    expect(verdictTerms('This is not proof that the declarant has breached the Act.')).toEqual([]);
    expect(verdictTerms('This does not mean the declarant has committed fraud.')).toEqual([]);
  });

  it('flags a perfect stated or barely negated', () => {
    expect(verdictTerms('The declarant has breached the Act.')).toEqual(['breached']);
    expect(verdictTerms('The declarant has not contravened the Act.')).toEqual(['contravened']);
    expect(verdictTerms('The declarant has committed fraud.')).toEqual(['fraud']);
  });

  it('carries a denial over a comma list', () => {
    expect(verdictTerms('This flag is not evidence of corruption, fraud or dishonesty.')).toEqual(
      [],
    );
    expect(verdictTerms('It is not a finding of wrongdoing, corruption or fraud.')).toEqual([]);
    expect(
      verdictTerms('This does not mean the declarant is corrupt, dishonest or non-compliant.'),
    ).toEqual([]);
    expect(verdictTerms('This is not evidence of corruption, fraud, or dishonesty.')).toEqual([]);
  });

  it('does not carry a denial past a comma into a new clause', () => {
    expect(verdictTerms('This is not corrupt, but the declarant is dishonest.')).toEqual([
      'dishonest',
    ]);
    expect(verdictTerms('Not a finding of wrongdoing; the declarant is corrupt.')).toEqual([
      'corrupt',
    ]);
    expect(verdictTerms('The declarant is not corrupt, in breach of the Act.')).toEqual([
      'in breach of',
    ]);
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
