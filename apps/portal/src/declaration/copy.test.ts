import { describe, expect, it } from 'vitest';

import { COPY, EXTRACTION_COPY, REGISTRY_COPY, ROSTER_HINT } from './copy';

describe('spec 05b copy', () => {
  it('gives every entry English and an empty Swahili slot', () => {
    for (const table of Object.values(COPY)) {
      for (const entry of Object.values(table)) {
        expect(typeof entry.en === 'function' || entry.en !== '').toBe(true);
        expect(entry.sw).toBe('');
      }
    }
  });

  it('reads English, with values where the copy has them', () => {
    expect(REGISTRY_COPY.heading).toBe('Registries');
    expect(REGISTRY_COPY.toReview(2)).toBe('2 to review');
    expect(EXTRACTION_COPY.page(3)).toBe('Page 3');
    expect(ROSTER_HINT).toBe("From your Commission's roster");
  });
});
