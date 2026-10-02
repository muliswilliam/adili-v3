import { describe, expect, it } from 'vitest';

import { asDeclaredFor, followsEarlierDeclaration } from '../../src/drafts/since-last.js';
import {
  assetItem,
  bio,
  incomeItem,
  liabilityItem,
  other,
  statement,
} from '../fixtures/sections.js';

const promoted = { changed: true, kind: 'value-change', explanation: 'Promoted in 2026.' };
const directorship = { company: 'Kitengela Farmers Ltd', role: 'Director', remunerated: false };

function flaggedBio() {
  return { ...bio(), maritalStatusChange: { changed: true } };
}

function flaggedStatement() {
  return {
    ...statement(),
    income: [{ ...incomeItem(), change: promoted }],
    assets: [{ ...assetItem(), change: { changed: true } }],
    liabilitiesNil: false,
    liabilities: [liabilityItem()],
  };
}

function flaggedOther() {
  const contents = other();
  return {
    ...contents,
    registrableInterests: {
      ...contents.registrableInterests,
      directorships: [{ ...directorship, change: promoted }],
      memberships: [{ entity: 'Rotary Club of Nairobi', kind: 'club', change: { changed: true } }],
    },
  };
}

describe('followsEarlierDeclaration', () => {
  it('is every type but the initial', () => {
    expect(followsEarlierDeclaration('initial')).toBe(false);
    expect(followsEarlierDeclaration('biennial')).toBe(true);
    expect(followsEarlierDeclaration('final')).toBe(true);
  });
});

describe('asDeclaredFor', () => {
  it('keeps every change flag of a declaration that follows an earlier one', () => {
    for (const type of ['biennial', 'final']) {
      const contents = flaggedStatement();
      expect(asDeclaredFor(type, 'bio', flaggedBio())).toEqual(flaggedBio());
      expect(asDeclaredFor(type, 'statement:officer', contents)).toBe(contents);
      expect(asDeclaredFor(type, 'other', flaggedOther())).toEqual(flaggedOther());
    }
  });

  it("drops an initial's marital status change", () => {
    expect(asDeclaredFor('initial', 'bio', flaggedBio())).toEqual(bio());
  });

  it("flags every item of an initial's statements unchanged, as declaration.v1 requires", () => {
    const contents = flaggedStatement();

    const declared = asDeclaredFor('initial', 'statement:officer', contents);

    expect(declared).toEqual({
      ...contents,
      income: [incomeItem()],
      assets: [assetItem()],
      liabilities: [liabilityItem()],
    });
    expect(contents.income[0]?.change).toEqual(promoted);
  });

  it("drops the flags of an initial's directorships and memberships", () => {
    const declared = asDeclaredFor('initial', 'other', flaggedOther());

    expect(declared.registrableInterests).toEqual({
      ...other().registrableInterests,
      directorships: [directorship],
      memberships: [{ entity: 'Rotary Club of Nairobi', kind: 'club' }],
    });
  });

  it('leaves the household and malformed contents as they are', () => {
    const household = { spouses: { none: true, items: [] }, children: { none: true, items: [] } };
    expect(asDeclaredFor('initial', 'household', household)).toBe(household);
    expect(asDeclaredFor('initial', 'statement:officer', { income: 'none', assets: [3] })).toEqual({
      income: 'none',
      assets: [3],
    });
    expect(asDeclaredFor('initial', 'other', { freeText: '' })).toEqual({ freeText: '' });
  });
});
