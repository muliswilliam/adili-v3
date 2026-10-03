import { describe, expect, it } from 'vitest';

import { formatPhone } from './phone.js';

describe('formatPhone', () => {
  it('groups a Kenyan number', () => {
    expect(formatPhone('+254712345678')).toBe('+254 712 345 678');
  });

  it("leaves other countries' numbers as stored", () => {
    expect(formatPhone('+442079460958')).toBe('+442079460958');
  });
});
