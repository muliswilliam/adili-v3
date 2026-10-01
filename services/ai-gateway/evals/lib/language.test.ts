import { describe, expect, it } from 'vitest';

import { detectLanguage } from './language.js';

describe('detectLanguage', () => {
  it('tells English from Swahili in reviewer prose', () => {
    expect(
      detectLanguage(
        'The declarant acquired a vehicle during the period and the value of the savings account rose by 43% since the previous declaration.',
      ),
    ).toBe('en');
    expect(
      detectLanguage(
        'Mtangazaji alinunua gari katika kipindi hiki na thamani ya akaunti ya akiba iliongezeka kwa asilimia 43 tangu tamko la awali.',
      ),
    ).toBe('sw');
  });

  it('declines to judge text too short to tell', () => {
    expect(detectLanguage('Toyota Prado, KDK 482M.')).toBeNull();
  });
});
