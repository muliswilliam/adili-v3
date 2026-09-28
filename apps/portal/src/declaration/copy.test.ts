import { describe, expect, it } from 'vitest';

import {
  EXTRACTION_COPY,
  HR_LABELS,
  PREFILL_COPY,
  REGISTRY_COPY,
  ROSTER_HINT,
  SUMMARY_COPY,
} from './copy';

describe('spec 05b copy', () => {
  it('gives every entry English and an empty Swahili slot', () => {
    for (const table of Object.values(PREFILL_COPY)) {
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
    expect(HR_LABELS.workStation).toBe('Work station');
    expect(SUMMARY_COPY.sourcedItems(1)).toBe('1 item from registries or documents');
    expect(SUMMARY_COPY.sourcedItems(3)).toBe('3 items from registries or documents');
  });
});
