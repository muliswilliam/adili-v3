import { describe, expect, it } from 'vitest';

import {
  isSectionKey,
  parsePersonKey,
  parseSectionKey,
  personKeyOf,
  relationOf,
  sectionKind,
  statementSectionKey,
} from './section-key';

const ID = '9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a';

describe('section keys', () => {
  it.each(['bio', 'household', 'other'] as const)('parses %s', (key) => {
    expect(parseSectionKey(key)).toEqual({ kind: key });
  });

  it.each(['officer', `spouse:${ID}`, `child:${ID}`])('parses the statement of %s', (person) => {
    expect(parseSectionKey(`statement:${person}`)).toEqual({
      kind: 'statement',
      personKey: person,
    });
  });

  it.each([
    'summary',
    'statement:',
    'statement:cousin:1',
    `statement:spouse:${ID.toUpperCase()}`,
    // The contract's pattern only checks the length; a canonical UUID is required here.
    'statement:spouse:------------------------------------',
    `statement:child:${ID}x`,
    `statement:officer:${ID}`,
  ])('refuses %s', (key) => {
    expect(parseSectionKey(key)).toBeNull();
    expect(isSectionKey(key)).toBe(false);
    expect(sectionKind(key)).toBeNull();
  });

  it('builds and takes apart statement keys', () => {
    expect(statementSectionKey('officer')).toBe('statement:officer');
    expect(personKeyOf(`statement:child:${ID}`)).toBe(`child:${ID}`);
    expect(personKeyOf('bio')).toBeNull();
    expect(parsePersonKey('cousin:1')).toBeNull();
  });

  it('says whose statement a key is', () => {
    expect(relationOf('statement:officer')).toBe('officer');
    expect(relationOf(`statement:spouse:${ID}`)).toBe('spouse');
    expect(relationOf(`statement:child:${ID}`)).toBe('child');
    expect(relationOf('household')).toBeNull();
  });
});
