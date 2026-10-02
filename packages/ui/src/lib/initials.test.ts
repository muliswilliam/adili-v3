import { describe, expect, it } from 'vitest';

import { initials } from './initials';

describe('initials', () => {
  it('takes the first letters of the first two words', () => {
    expect(initials('Juma Omondi')).toBe('JO');
    expect(initials('  amina  ')).toBe('A');
    expect(initials('Dr. Paul Odhiambo')).toBe('DP');
  });

  it('is empty for a blank name', () => {
    expect(initials('   ')).toBe('');
  });
});
