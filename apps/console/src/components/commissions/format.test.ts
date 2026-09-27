import { describe, expect, it } from 'vitest';

import { OFFICER_CATEGORIES } from '../../server/directory/mock.server';
import {
  formatAgo,
  formatDate,
  formatDateTime,
  formatNumber,
  onboardedPercent,
  summariseCategories,
} from './format';
import { messages } from './messages';

describe('formatAgo', () => {
  // 00:30 on 26 September in Nairobi.
  const now = new Date('2026-09-25T21:30:00Z');

  it('counts Kenyan calendar days, not 24-hour periods', () => {
    expect(formatAgo('2026-09-25T21:10:00Z', now)).toBe('today');
    expect(formatAgo('2026-09-25T20:50:00Z', now)).toBe('yesterday');
    expect(formatAgo('2026-09-14T09:00:00Z', now)).toBe('12 days ago');
  });

  it('switches to months from day 31', () => {
    expect(formatAgo('2026-08-27T10:00:00Z', now)).toBe('30 days ago');
    expect(formatAgo('2026-08-20T10:00:00Z', now)).toBe('1 month ago');
    expect(formatAgo('2026-07-20T10:00:00Z', now)).toBe('2 months ago');
  });
});

describe('formatDateTime', () => {
  it('formats in Kenyan time', () => {
    expect(formatDateTime('2026-09-01T07:00:00Z')).toMatch(/1 Sept? 2026.*10:00/);
    expect(formatDate('2026-09-01T22:00:00Z')).toMatch(/^2 Sept? 2026$/);
  });
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(48312)).toBe('48,312');
    expect(messages.rosterOnboarded(6904, 48312)).toBe('6,904 of 48,312 onboarded');
  });
});

describe('onboardedPercent', () => {
  it('rounds and copes with an empty roster', () => {
    expect(onboardedPercent(6904, 48312)).toBe(14);
    expect(onboardedPercent(0, 0)).toBe(0);
  });
});

describe('summariseCategories', () => {
  it('shows two categories and keeps the rest for the "+N" chip', () => {
    const { visible, hidden } = summariseCategories(OFFICER_CATEGORIES.slice(0, 4));
    expect(visible.map((category) => category.citation)).toEqual(['Act s.32(2)', 'Act s.32(3)']);
    expect(hidden.map((category) => category.citation)).toEqual(['Act s.32(4)', 'Act s.32(5)']);
    expect(messages.categoriesMore(hidden.map((category) => category.citation))).toBe(
      '2 more: Act s.32(4), Act s.32(5)',
    );
  });

  it('has nothing hidden for two or fewer', () => {
    expect(summariseCategories(OFFICER_CATEGORIES.slice(0, 1)).hidden).toEqual([]);
  });
});

describe('count line', () => {
  it('counts Commissions or matches, with a "+" while more pages remain', () => {
    expect(messages.count(1, { filtered: false, more: false })).toBe('1 Commission');
    expect(messages.count(1250, { filtered: false, more: false })).toBe('1,250 Commissions');
    expect(messages.count(0, { filtered: true, more: false })).toBe('0 matches');
    expect(messages.count(1, { filtered: true, more: false })).toBe('1 match');
    expect(messages.count(50, { filtered: false, more: true })).toBe('50+ Commissions');
  });
});
