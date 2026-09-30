import { describe, expect, it } from 'vitest';

import { ASSET_TYPES, INCOME_TYPES, LIABILITY_TYPES } from '@adili/forms';

import { CORPUS_TAGS, ITEM_TYPE_TAGS } from '../../src/help/corpus.js';
import { ENGLISH_SYNONYMS, expand, SWAHILI_GLOSSARY, words } from '../../src/help/glossary.js';
import { searchTerms } from '../../src/help/retrieval.js';

describe('the Swahili glossary', () => {
  it('adds the English of the law for each Swahili term, longest phrase first', () => {
    expect(expand('Je, matatu ninayomiliki pamoja ni mali?', SWAHILI_GLOSSARY)).toEqual([
      'vehicle',
      'joint',
      'assets',
    ]);
    expect(expand('mali ya pamoja', SWAHILI_GLOSSARY)).toEqual(['joint assets']);
    expect(expand('Mabadiliko makubwa ni nini?', SWAHILI_GLOSSARY)).toEqual(['material change']);
  });

  it('ignores words that are not terms, including object property names', () => {
    expect(expand('constructor toString hasOwnProperty', SWAHILI_GLOSSARY)).toEqual([]);
  });

  it('holds lowercase terms, single-spaced, with English words only', () => {
    for (const [term, english] of Object.entries({ ...SWAHILI_GLOSSARY, ...ENGLISH_SYNONYMS })) {
      expect(words(term).join(' ')).toBe(term);
      expect(english).toMatch(/^[a-z]+(?: [a-z]+)*$/);
    }
  });

  it('searches a Swahili question as Swahili words in simple and glossary English in english', () => {
    expect(searchTerms('Je, zawadi ya mke wangu?', 'sw')).toEqual({
      english: 'gift spouse',
      simple: 'zawadi mke',
    });
    expect(searchTerms("My wife's car", 'en')).toEqual({
      english: 'my wife s car spouse vehicle',
      simple: '',
    });
  });
});

describe('corpus tags', () => {
  it('include every statement item type except other', () => {
    const itemTypes = [...ASSET_TYPES, ...LIABILITY_TYPES, ...INCOME_TYPES].filter(
      (type) => type !== 'other',
    );
    expect([...ITEM_TYPE_TAGS].sort()).toEqual([...new Set(itemTypes)].sort());
    for (const tag of ITEM_TYPE_TAGS) expect(CORPUS_TAGS).toContain(tag);
  });
});
