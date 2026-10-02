import { describe, expect, it } from 'vitest';

import type { DeclarantNotice } from '../server/access/types';
import {
  historyOf,
  leaTitle,
  needsResponse,
  noticeState,
  scopeLine,
  sortNotices,
  windowOpen,
  windowView,
} from './notices';

const NOW = '2026-10-02T07:00:00Z';

function notice(fields: Partial<DeclarantNotice> = {}): DeclarantNotice {
  return {
    requestId: 'b7e10000-0000-4000-8000-000000000001',
    reference: 'ARQ-TSC-2026-0000052-I',
    kind: 'form-k',
    commission: { slug: 'tsc', name: 'Teachers Service Commission' },
    status: 'awaiting-representations',
    applicantName: 'Wanjiru Kamau',
    agency: null,
    caseReference: null,
    purposeInGeneralTerms: 'Journalistic research',
    scope: {
      years: [2026],
      includeSpouses: true,
      includeChildren: false,
      sections: ['liabilities', 'income', 'assets'],
    },
    notifiedAt: '2026-09-29T07:00:00Z',
    windowEndsAt: '2026-10-06T07:00:00Z',
    canRespond: true,
    representations: null,
    decision: null,
    ...fields,
  };
}

const SENT = {
  stance: 'object' as const,
  text: 'In court.',
  attachments: [],
  submittedAt: '2026-09-30T07:00:00Z',
  updatedAt: '2026-09-30T07:00:00Z',
};

const DECISION = {
  outcome: 'partial-grant' as const,
  grantedScope: null,
  grounds: ['not-objectives' as const],
  reasons: 'Only part is needed.',
  decidedBy: { subject: 's', name: 'Officer Name' },
  decidedAt: '2026-10-20T09:00:00Z',
};

describe('the window', () => {
  it('is open while the service says so and its end has not passed', () => {
    expect(windowOpen(notice(), NOW)).toBe(true);
    expect(windowOpen(notice(), '2026-10-06T07:00:00Z')).toBe(false);
    expect(windowOpen(notice({ canRespond: false }), NOW)).toBe(false);
    expect(windowOpen(notice({ kind: 'lea' }), NOW)).toBe(false);
  });

  it('waits for the declarant only until they respond', () => {
    expect(needsResponse(notice(), NOW)).toBe(true);
    expect(needsResponse(notice({ representations: SENT }), NOW)).toBe(false);
  });

  it('counts down in calendar days while open, red on the last day', () => {
    expect(windowView(notice(), NOW)).toMatchObject({
      open: true,
      title: '4 days left',
      detail: 'Respond by 6 Oct 2026, 10:00 · day 3 of 7',
      tone: 'warning',
      day: 3,
      of: 7,
    });
    expect(windowView(notice({ representations: SENT }), NOW)?.detail).toMatch(/^Edit until/);
    expect(windowView(notice(), '2026-10-06T05:00:00Z')).toMatchObject({
      title: 'Closes today',
      tone: 'danger',
    });
  });

  it('says how it closed, early on consent', () => {
    const closed = notice({ status: 'under-decision', canRespond: false });
    expect(windowView(closed, NOW)).toMatchObject({
      open: false,
      title: 'Window closed',
      detail: 'Closed 6 Oct 2026, 10:00',
    });
    expect(
      windowView({ ...closed, representations: { ...SENT, stance: 'consent' } }, NOW),
    ).toMatchObject({ title: 'Closed early', detail: 'You consented on 30 Sep 2026' });
  });

  it('is not shown once decided, withdrawn, or for law enforcement', () => {
    expect(
      windowView(
        notice({ status: 'denied', canRespond: false, decision: { ...DECISION, outcome: 'deny' } }),
        NOW,
      ),
    ).toBeNull();
    expect(windowView(notice({ status: 'withdrawn', canRespond: false }), NOW)).toBeNull();
    expect(windowView(notice({ kind: 'lea', windowEndsAt: null }), NOW)).toBeNull();
  });
});

describe('noticeState', () => {
  it('reads every state the declarant can see', () => {
    expect(noticeState(notice(), NOW)).toBe('awaiting');
    expect(noticeState(notice({ representations: SENT }), NOW)).toBe('saved');
    expect(noticeState(notice({ status: 'under-decision', canRespond: false }), NOW)).toBe(
      'under-decision',
    );
    // The window ended since the service answered: under decision, though not yet updated.
    expect(noticeState(notice(), '2026-10-07T00:00:00Z')).toBe('under-decision');
    expect(noticeState(notice({ status: 'partially-granted', decision: DECISION }), NOW)).toBe(
      'partial-grant',
    );
    const decided = (outcome: 'grant' | 'deny') => ({ ...DECISION, outcome });
    expect(
      noticeState(
        notice({ status: 'granted', canRespond: false, decision: decided('grant') }),
        NOW,
      ),
    ).toBe('grant');
    expect(
      noticeState(notice({ status: 'denied', canRespond: false, decision: decided('deny') }), NOW),
    ).toBe('deny');
    expect(noticeState(notice({ status: 'withdrawn', canRespond: false }), NOW)).toBe('withdrawn');
    expect(noticeState(notice({ kind: 'lea', status: 'granted' }), NOW)).toBe('lea');
  });
});

describe('sortNotices', () => {
  it('puts those waiting for a response first, then open windows, then the latest', () => {
    const waiting = notice({ requestId: 'a', notifiedAt: '2026-09-20T07:00:00Z' });
    const saved = notice({ requestId: 'b', representations: SENT });
    const older = notice({
      requestId: 'c',
      status: 'denied',
      canRespond: false,
      notifiedAt: '2026-08-01T07:00:00Z',
    });
    const newer = notice({
      requestId: 'd',
      status: 'under-decision',
      canRespond: false,
      notifiedAt: '2026-09-25T07:00:00Z',
    });
    expect(sortNotices([older, saved, newer, waiting], NOW).map((each) => each.requestId)).toEqual([
      'a',
      'b',
      'd',
      'c',
    ]);
  });
});

describe('scopeLine', () => {
  it('reads the scope on one line, sections in the form’s order', () => {
    expect(scopeLine(notice().scope)).toBe('2026 · You and spouse · Income, assets, liabilities');
    expect(
      scopeLine({
        years: [2026, 2025],
        includeSpouses: true,
        includeChildren: true,
        sections: ['bio'],
      }),
    ).toBe('2025, 2026 · You, spouse and children · Personal details');
    expect(scopeLine({ ...notice().scope, includeSpouses: false, includeChildren: true })).toMatch(
      / · You and children · /,
    );
    expect(scopeLine({ ...notice().scope, includeSpouses: false })).toMatch(/ · You only · /);
  });
});

describe('the history', () => {
  it('shows notified, the response (edited) and the decision, without staff names', () => {
    const entries = historyOf(
      notice({
        status: 'partially-granted',
        representations: { ...SENT, updatedAt: '2026-10-01T07:00:00Z' },
        decision: DECISION,
      }),
    );
    expect(entries.map((entry) => [entry.kind, entry.title, entry.actor])).toEqual([
      [
        'notified',
        'Wanjiru Kamau asked to see your declaration',
        'Notified by Teachers Service Commission',
      ],
      ['representations', 'You objected', 'You · edited'],
      [
        'decided',
        'Teachers Service Commission partially granted access',
        'Access officer, Teachers Service Commission',
      ],
    ]);
  });

  it('shows a law-enforcement grant only', () => {
    const lea = notice({
      kind: 'lea',
      applicantName: 'Asset Recovery Agency',
      agency: { code: 'ARA', name: 'Asset Recovery Agency' },
      caseReference: 'ARA/INV/2026/014',
      decision: { ...DECISION, outcome: 'grant', decidedAt: '2026-09-02T12:30:00Z' },
    });
    expect(historyOf(lea).map((entry) => entry.title)).toEqual([
      'Asset Recovery Agency was granted access',
    ]);
    expect(leaTitle(lea)).toBe(
      'A law-enforcement agency was granted access on 2 Sep 2026 (Asset Recovery Agency, case ARA/INV/2026/014)',
    );
    expect(leaTitle({ ...lea, caseReference: null })).toBe(
      'A law-enforcement agency was granted access on 2 Sep 2026 (Asset Recovery Agency)',
    );
  });
});
