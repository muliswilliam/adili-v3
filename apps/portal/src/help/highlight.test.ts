import { describe, expect, it } from 'vitest';

import { highlight } from './highlight';

describe('highlight', () => {
  it('marks the searched words where a word starts, whatever the case', () => {
    expect(highlight('Declare jointly held assets. Joint owners', 'joint')).toEqual([
      { text: 'Declare ', match: false },
      { text: 'joint', match: true },
      { text: 'ly held assets. ', match: false },
      { text: 'Joint', match: true },
      { text: ' owners', match: false },
    ]);
  });

  it('marks nothing inside a word or for short words', () => {
    expect(highlight('disjoint of', 'joint of')).toEqual([{ text: 'disjoint of', match: false }]);
  });

  it('takes the query as words, not as a pattern', () => {
    expect(highlight('a (b) c', '(b)')).toEqual([{ text: 'a (b) c', match: false }]);
  });
});
