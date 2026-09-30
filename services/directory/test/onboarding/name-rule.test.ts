import { describe, expect, it } from 'vitest';

import { namesMatch, nameTokens } from '../../src/onboarding/iprs/name-rule.js';

/** The confirm step's name rule (spec 03), with the cases rosters actually produce. */
describe('namesMatch', () => {
  const iprs = { firstName: 'Wanjiru', middleName: 'Achieng', lastName: 'Otieno' };

  it.each([
    ['the same names', 'Wanjiru Achieng Otieno'],
    ['names in another order', 'OTIENO Wanjiru Achieng'],
    ['the middle name left out', 'Wanjiru Otieno'],
    ['the middle name abbreviated', 'Wanjiru A. Otieno'],
    ['more names on the roster', 'Wanjiru Njeri Achieng Otieno'],
    ['other case, spacing and punctuation', '  otieno,   WANJIRU  '],
  ])('matches %s', (_case, roster) => {
    expect(namesMatch(iprs, roster)).toBe(true);
  });

  it.each([
    ['a different last name', 'Wanjiru Achieng Kamau'],
    ['the first name missing', 'Achieng Otieno'],
    ['a first name only', 'Wanjiru'],
    ['a misspelt name', 'Wanjiro Otieno'],
  ])('does not match %s', (_case, roster) => {
    expect(namesMatch(iprs, roster)).toBe(false);
  });

  it('requires every token of multi-word first and last names', () => {
    const person = { firstName: 'Mary Anne', middleName: null, lastName: 'Wa Njeri' };

    expect(namesMatch(person, 'Mary Anne Wa Njeri')).toBe(true);
    expect(namesMatch(person, 'Mary Wa Njeri')).toBe(false);
  });

  it('strips punctuation inside names rather than splitting on it', () => {
    expect(namesMatch({ ...iprs, lastName: "O'tieno" }, 'Wanjiru Otieno')).toBe(true);
    expect(namesMatch({ ...iprs, lastName: 'Otieno-Kamau' }, 'Wanjiru OtienoKamau')).toBe(true);
    expect(namesMatch({ ...iprs, lastName: 'Otieno-Kamau' }, 'Wanjiru Otieno Kamau')).toBe(false);
  });

  it('never matches empty IPRS names', () => {
    expect(namesMatch({ firstName: ' ', middleName: null, lastName: '.' }, 'Anyone')).toBe(false);
  });
});

describe('nameTokens', () => {
  it('upper-cases, strips punctuation and splits on whitespace, keeping letters of any script', () => {
    expect(nameTokens(" Chép'ngétich\tJosé-María  O. ")).toEqual(['CHÉPNGÉTICH', 'JOSÉMARÍA', 'O']);
  });
});
