import { describe, expect, it } from 'vitest';

import { QUESTION_THEMES, themeOf } from '../../src/assistant/themes.js';

/**
 * Question themes (spec 11 S8): the fixed list a Commission's anonymised counts are kept by, and
 * the keyword rules that map a question to one, in English and Kiswahili.
 */

describe('themeOf', () => {
  it.each([
    ["Do I declare my wife's salary?", 'income'],
    ['Do I declare my husband?', 'household-spouses'],
    ['Nitaandika mke wangu wapi?', 'household-spouses'],
    ['Does my 19 year old son need a statement?', 'children'],
    ['Watoto wangu wanahitaji taarifa?', 'children'],
    ['Do I include my late father’s land that has not been transferred?', 'land'],
    ['Nyumba yangu ya kupangisha', 'land'],
    ['Is a matatu an asset?', 'vehicles'],
    ['Je, gari langu ni mali?', 'vehicles'],
    ['How do I declare my M-Pesa and bank balances?', 'bank-accounts'],
    ['Akaunti ya benki ya pamoja na mama?', 'joint-ownership'],
    ['Do I list shares in a SACCO?', 'shares-businesses'],
    ['Hisa zangu katika kampuni', 'shares-businesses'],
    ['Is my mortgage a liability?', 'loans'],
    ['Mkopo wa benki niandike wapi?', 'loans'],
    ['What counts as a material change?', 'material-changes'],
    ['Mabadiliko makubwa ni yapi?', 'material-changes'],
    ['When is the deadline to file?', 'dates-obligations'],
    ['Tarehe ya mwisho ni lini?', 'dates-obligations'],
    ['I own a flat in Kampala, outside Kenya', 'assets-abroad'],
    ['Shamba nje ya nchi', 'assets-abroad'],
    ['Is a matatu I co-own with my brother an asset?', 'joint-ownership'],
    ['Am I a director of a company I must register?', 'registrable-interests'],
    ['I did not get the sign-in code', 'using-adili'],
    ['Nimesahau nenosiri', 'using-adili'],
  ])('maps %j to %s', (question, theme) => {
    expect(themeOf(question)).toBe(theme);
  });

  it('maps a question no rule matches to other', () => {
    expect(themeOf('Habari yako?')).toBe('other');
    expect(themeOf('What is this?')).toBe('other');
  });

  it('matches whole words only', () => {
    // "carpet" has "car", "loaned" is not "loan" here, "landed" is not "land".
    expect(themeOf('Is a carpet worth listing?')).toBe('other');
  });

  it('always returns a theme of the fixed list', () => {
    for (const question of ['', '???', 'land', 'ARDHI']) {
      expect(QUESTION_THEMES).toContain(themeOf(question));
    }
  });
});
