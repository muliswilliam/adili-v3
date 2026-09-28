import { describe, expect, it } from 'vitest';

import type { RosterSummary } from '../../server/directory/client';
import { onboardedPercent, rosterCoverage, toOnboard } from './coverage';

const imported: RosterSummary = {
  status: 'imported',
  expectedDeclarants: 48312,
  onboardedDeclarants: 12108,
  flagged: 37,
  lastImportAt: '2026-09-21T09:40:00Z',
  lastImportId: '0191f8d2-0000-7000-8000-000000000001',
  lastCompleteImportAt: '2026-09-21T09:40:00Z',
};

describe('onboardedPercent', () => {
  it('rounds down', () => {
    expect(onboardedPercent(12108, 48312)).toBe(25);
    expect(onboardedPercent(999, 1000)).toBe(99);
  });

  it('is 100 only when everyone onboarded', () => {
    expect(onboardedPercent(1000, 1000)).toBe(100);
  });

  it('is 0 with nobody expected', () => {
    expect(onboardedPercent(0, 0)).toBe(0);
  });

  it('never goes over 100', () => {
    expect(onboardedPercent(12, 10)).toBe(100);
  });
});

describe('toOnboard', () => {
  it('counts the declarants still to onboard', () => {
    expect(toOnboard(imported)).toBe(36204);
  });

  it('is never negative', () => {
    expect(toOnboard({ expectedDeclarants: 3, onboardedDeclarants: 5 })).toBe(0);
  });
});

describe('rosterCoverage', () => {
  it('is null until a roster is imported', () => {
    expect(
      rosterCoverage({
        status: 'none',
        expectedDeclarants: 0,
        onboardedDeclarants: 0,
        flagged: 0,
        lastImportAt: null,
        lastImportId: null,
        lastCompleteImportAt: null,
      }),
    ).toBeNull();
  });

  it('gives the counts and the last import of an imported roster', () => {
    expect(rosterCoverage(imported)).toEqual({
      onboarded: 12108,
      expected: 48312,
      flagged: 37,
      lastImportAt: '2026-09-21T09:40:00Z',
    });
  });
});
