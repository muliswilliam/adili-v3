import { describe, expect, it } from 'vitest';

import { OFFICER_CATEGORIES } from '../../server/directory/mock.server';
import { formatDateTime, formatRelative, summariseCategories } from './format';

describe('formatRelative', () => {
  const now = new Date('2026-09-25T12:00:00Z');

  it('picks the largest whole unit', () => {
    expect(formatRelative('2026-09-22T12:00:00Z', now)).toBe('3 days ago');
    expect(formatRelative('2026-09-25T09:00:00Z', now)).toBe('3 hours ago');
    expect(formatRelative('2026-09-18T12:00:00Z', now)).toBe('last week');
  });

  it('says "just now" under a minute', () => {
    expect(formatRelative('2026-09-25T11:59:30Z', now)).toBe('just now');
  });
});

describe('formatDateTime', () => {
  it('formats in Kenyan time', () => {
    expect(formatDateTime('2026-09-01T07:00:00Z')).toMatch(/1 Sept? 2026.*10:00/);
  });
});

describe('summariseCategories', () => {
  it('shows two citations and counts the rest', () => {
    expect(summariseCategories(OFFICER_CATEGORIES.slice(0, 4))).toEqual({
      visible: ['Act s.32(2)', 'Act s.32(3)'],
      hidden: ['Act s.32(4)', 'Act s.32(5)'],
    });
  });

  it('has nothing hidden for two or fewer', () => {
    expect(summariseCategories(OFFICER_CATEGORIES.slice(0, 1)).hidden).toEqual([]);
  });
});
