import { describe, expect, it } from 'vitest';

import type { DeclarantNotice } from '../server/review/types';
import { canRespond, followedBy, ladderOf, urgentNotice, windowOf } from './view';

const NOW = '2026-09-28T09:00:00.000Z';

function notice(overrides: Partial<DeclarantNotice>): DeclarantNotice {
  return {
    actionId: crypto.randomUUID(),
    ladderId: 'ladder-filing',
    subject: { kind: 'obligation', reference: 'biennial:2026', dueAt: null },
    windowDays: 14,
    commission: { slug: 'tsc', name: 'Teachers Service Commission' },
    step: 'notice-to-comply',
    status: 'issued',
    issuedAt: '2026-09-23T09:00:00.000Z',
    actBy: '2026-10-07T09:00:00.000Z',
    whatToDo: 'file-declaration',
    reference: 'ADM-TSC-2026-0000412-U',
    letterDownloadUrl: null,
    response: null,
    salaryStoppedAt: null,
    salaryReinstatedAt: null,
    ...overrides,
  };
}

const CLARIFICATION = {
  ladderId: 'ladder-clarification',
  subject: { kind: 'clarification' as const, reference: 'CLR-TSC-2026-0000519-L', dueAt: null },
};
const first = notice({
  ...CLARIFICATION,
  whatToDo: 'respond-to-clarification',
  issuedAt: '2026-09-12T09:00:00.000Z',
  actBy: '2026-09-26T09:00:00.000Z',
});
const warning = notice({
  ...CLARIFICATION,
  step: 'warning',
  whatToDo: 'respond-to-clarification',
  issuedAt: '2026-09-26T09:00:00.000Z',
  actBy: '2026-10-10T09:00:00.000Z',
});
const filing = notice({});
const oldComplied = notice({
  ladderId: 'ladder-2024',
  status: 'complied',
  issuedAt: '2025-12-01T09:00:00.000Z',
});
const all = [warning, filing, first, oldComplied];

describe('followedBy', () => {
  it('finds the later step of the same ladder', () => {
    expect(followedBy(first, all)?.actionId).toBe(warning.actionId);
    expect(followedBy(warning, all)).toBeNull();
    expect(followedBy(filing, all)).toBeNull();
  });

  it('keeps two ladders of the same Commission and kind apart', () => {
    const other = notice({
      ladderId: 'ladder-other-clarification',
      subject: { kind: 'clarification', reference: 'CLR-TSC-2026-0000777-X', dueAt: null },
      whatToDo: 'respond-to-clarification',
      step: 'warning',
      issuedAt: '2026-09-27T09:00:00.000Z',
    });
    expect(followedBy(first, [...all, other])?.actionId).toBe(warning.actionId);
    expect(
      followedBy(notice({ ...CLARIFICATION, whatToDo: 'respond-to-clarification' }), [other]),
    ).toBeNull();
  });
});

describe('urgentNotice', () => {
  it('is the open notice with the nearest act-by date, not one a later step replaced', () => {
    expect(urgentNotice(all, NOW)?.actionId).toBe(filing.actionId);
    expect(urgentNotice([warning, first], NOW)?.actionId).toBe(warning.actionId);
    expect(urgentNotice([oldComplied], NOW)).toBeNull();
  });
});

describe('ladderOf', () => {
  it('marks earlier steps issued, this one current and later ones not issued', () => {
    expect(ladderOf(warning, all)).toEqual([
      { step: 'notice-to-comply', state: 'issued', issuedAt: first.issuedAt },
      { step: 'warning', state: 'current', issuedAt: warning.issuedAt },
      { step: 'salary-stoppage', state: 'not-issued', issuedAt: null },
      { step: 'disciplinary-referral', state: 'not-issued', issuedAt: null },
    ]);
  });

  it('marks a closed ladder complied', () => {
    expect(ladderOf(oldComplied, all).map((step) => step.state)).toEqual([
      'complied',
      'not-issued',
      'not-issued',
      'not-issued',
    ]);
  });
});

describe('windowOf', () => {
  it('counts the days left and the day of the window', () => {
    expect(windowOf(filing, NOW)).toEqual({ daysLeft: 9, day: 5, of: 14 });
    expect(windowOf(first, NOW)).toEqual({ daysLeft: -2, day: 14, of: 14 });
    expect(windowOf(notice({ actBy: null }), NOW)).toBeNull();
  });
});

describe('canRespond', () => {
  it('admits one response to an issued notice or warning', () => {
    expect(canRespond(filing)).toBe(true);
    expect(canRespond(warning)).toBe(true);
    expect(canRespond(notice({ status: 'responded' }))).toBe(false);
    expect(canRespond(oldComplied)).toBe(false);
    expect(canRespond(notice({ step: 'salary-stoppage' }))).toBe(false);
  });
});
