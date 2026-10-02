import { describe, expect, it } from 'vitest';

import { clarificationCrumb, historyOf, statusLine } from './view';

const base = {
  issuedAt: '2026-09-20T09:00:00Z',
  dueAt: '2026-10-20T09:00:00Z',
  respondedAt: null,
  responseLate: false,
  resolvedAt: null,
  resolutionNote: null,
};
const NOW = '2026-09-28T09:00:00Z';

describe('statusLine', () => {
  it('says the declarant is being waited on, with the due date and the reminder', () => {
    expect(statusLine({ ...base, status: 'issued' }, NOW)).toEqual({
      tone: 'info',
      title: 'Waiting for the declarant.',
      body: 'Due in 22 days. Reminder goes 10 Oct 2026.',
    });
    expect(
      statusLine(
        {
          ...base,
          status: 'issued',
          issuedAt: '2026-09-01T09:00:00Z',
          dueAt: '2026-10-01T09:00:00Z',
        },
        NOW,
      ).body,
    ).toBe('Due in 3 days. Reminder sent 21 Sep 2026.');
  });

  it('says how late a response was, or that it was on time', () => {
    expect(
      statusLine(
        {
          ...base,
          status: 'responded',
          dueAt: '2026-09-19T09:00:00Z',
          respondedAt: '2026-09-22T10:00:00Z',
          responseLate: true,
        },
        NOW,
      ),
    ).toEqual({ tone: 'warning', title: 'Responded 3 days late', body: 'On 22 Sep 2026, 13:00.' });
    expect(
      statusLine({ ...base, status: 'responded', respondedAt: '2026-09-25T10:00:00Z' }, NOW),
    ).toEqual({ tone: 'success', title: 'Responded on time', body: 'On 25 Sep 2026, 13:00.' });
  });

  it('says an overdue clarification can still be answered, late', () => {
    expect(statusLine({ ...base, status: 'overdue', dueAt: '2026-09-19T09:00:00Z' }, NOW)).toEqual({
      tone: 'destructive',
      title: 'Overdue since 19 Sep 2026.',
      body: 'Not answered by the due date. The declarant can still respond; the response will be marked late.',
    });
  });

  it('shows the resolution note, the withdrawal and a draft', () => {
    expect(
      statusLine(
        {
          ...base,
          status: 'resolved',
          resolvedAt: '2026-09-27T09:00:00Z',
          resolutionNote: 'Explained.',
        },
        NOW,
      ),
    ).toEqual({ tone: 'success', title: 'Resolved 27 Sep 2026.', body: 'Explained.' });
    expect(statusLine({ ...base, status: 'withdrawn' }, NOW)).toEqual({
      tone: 'neutral',
      title: 'Withdrawn.',
      body: 'Letter revoked as issued in error; no response needed.',
    });
    expect(statusLine({ ...base, status: 'draft', issuedAt: null, dueAt: null }, NOW)).toEqual({
      tone: 'neutral',
      title: 'Not sent.',
      body: 'The declarant cannot see drafts.',
    });
  });
});

describe('historyOf', () => {
  it('lists what happened to a clarification, oldest first', () => {
    const late = historyOf(
      {
        ...base,
        status: 'resolved',
        issuedAt: '2026-08-01T09:00:00Z',
        dueAt: '2026-08-31T09:00:00Z',
        respondedAt: '2026-09-03T09:00:00Z',
        responseLate: true,
        resolvedAt: '2026-09-10T09:00:00Z',
        reference: 'CLR-TSC-2026-0000017-X',
      },
      NOW,
    );
    expect(late.map((entry) => [entry.title, entry.at])).toEqual([
      ['Issued CLR-TSC-2026-0000017-X', '1 Aug 2026, 12:00'],
      ['Reminder sent by email and SMS (day 20)', '21 Aug 2026'],
      ['Response received, late', '3 Sep 2026, 12:00'],
      ['Marked resolved', '10 Sep 2026'],
    ]);
  });

  it('shows the overdue mark and no reminder after an early response or a withdrawal', () => {
    expect(
      historyOf(
        {
          ...base,
          status: 'overdue',
          issuedAt: '2026-08-20T09:00:00Z',
          dueAt: '2026-09-19T09:00:00Z',
          reference: 'R',
        },
        NOW,
      ).map((entry) => entry.title),
    ).toEqual(['Issued R', 'Reminder sent by email and SMS (day 20)', 'Marked overdue']);
    expect(
      historyOf(
        { ...base, status: 'withdrawn', issuedAt: '2026-08-01T09:00:00Z', reference: 'R' },
        NOW,
      ).map((entry) => entry.title),
    ).toEqual(['Issued R', 'Withdrawn · letter revoked as issued in error']);
    expect(
      historyOf({ ...base, status: 'draft', issuedAt: null, dueAt: null, reference: null }, NOW),
    ).toEqual([]);
  });
});

describe('clarificationCrumb', () => {
  const CASE = 'c45e0000-0000-4000-8000-000000000001';
  const loaded = (reference: string | null) => ({
    ok: true,
    data: { clarification: { reference }, case: { id: CASE, reference: 'DCI-PSC-2026-0000001-Y' } },
  });
  const toCase = { label: 'DCI-PSC-2026-0000001-Y', to: `/review/cases/${CASE}` };

  it('links the case it is on, then names the clarification by its reference', () => {
    expect(clarificationCrumb(loaded('CLR-PSC-2026-0000001-A'))).toEqual({
      before: [toCase],
      label: 'CLR-PSC-2026-0000001-A',
    });
  });

  it('calls a draft a draft clarification', () => {
    expect(clarificationCrumb(loaded(null))).toEqual({
      before: [toCase],
      label: 'Draft clarification',
    });
  });

  it('says Clarification when it could not be loaded, and nothing while loading', () => {
    expect(clarificationCrumb({ ok: false, error: { kind: 'unavailable' } })).toBe('Clarification');
    expect(clarificationCrumb(undefined)).toBeNull();
  });
});
