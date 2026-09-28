import { describe, expect, it } from 'vitest';

import {
  clarificationActions,
  historyOf,
  resolveNoteError,
  resolveOutcome,
  statusLine,
  withdrawReasonError,
} from './clarification';

const base = {
  issuedAt: '2026-09-20T09:00:00Z',
  dueAt: '2026-10-20T09:00:00Z',
  respondedAt: null,
  responseLate: false,
  resolvedAt: null,
  resolutionNote: null,
};
const NOW = '2026-09-28T09:00:00Z';

describe('clarificationActions', () => {
  it('lets the assignee resolve while it is out, follow up once answered, withdraw before', () => {
    const at = (status: Parameters<typeof clarificationActions>[0]['status']) =>
      clarificationActions({ status, mine: true, windowOpen: true });
    expect(at('issued')).toEqual({ resolve: true, followUp: 'hidden', withdraw: true });
    expect(at('overdue')).toEqual({ resolve: true, followUp: 'enabled', withdraw: true });
    expect(at('responded')).toEqual({ resolve: true, followUp: 'enabled', withdraw: false });
    expect(at('resolved')).toEqual({ resolve: false, followUp: 'enabled', withdraw: false });
    expect(at('withdrawn')).toEqual({ resolve: false, followUp: 'hidden', withdraw: false });
    expect(at('draft')).toEqual({ resolve: false, followUp: 'hidden', withdraw: false });
  });

  it('offers nothing to someone who does not hold the case', () => {
    expect(clarificationActions({ status: 'responded', mine: false, windowOpen: true })).toEqual({
      resolve: false,
      followUp: 'hidden',
      withdraw: false,
    });
  });

  it('disables a follow-up once the six-month window has closed', () => {
    expect(
      clarificationActions({ status: 'responded', mine: true, windowOpen: false }).followUp,
    ).toBe('disabled');
  });
});

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

  it('points an overdue clarification to Actions (spec 08)', () => {
    expect(statusLine({ ...base, status: 'overdue', dueAt: '2026-09-19T09:00:00Z' }, NOW)).toEqual({
      tone: 'destructive',
      title: 'Overdue since 20 Sep 2026.',
      body: 'A notice to comply is drafted for approval under Actions.',
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

describe('dialogs', () => {
  it('requires a resolution note of up to 2,000 characters', () => {
    expect(resolveNoteError('  ')).toBe('Add a note so colleagues know why it is resolved.');
    expect(resolveNoteError('x'.repeat(2001))).toBe('Keep the note to 2,000 characters or fewer.');
    expect(resolveNoteError('Explained with a loan statement.')).toBeNull();
  });

  it('requires a withdrawal reason of up to 1,000 characters', () => {
    expect(withdrawReasonError('')).toBe('Give a reason. It is kept with the record.');
    expect(withdrawReasonError('x'.repeat(1001))).toBe(
      'Keep the reason to 1,000 characters or fewer.',
    );
    expect(withdrawReasonError('Issued against the wrong item')).toBeNull();
  });

  it('says what resolving does to the case', () => {
    expect(resolveOutcome(0)).toBe('The case becomes ready for determination.');
    expect(resolveOutcome(2)).toBe(
      '2 other clarifications still open. The case stays awaiting clarification.',
    );
    expect(resolveOutcome(1)).toBe(
      '1 other clarification still open. The case stays awaiting clarification.',
    );
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
      ['Issued CLR-TSC-2026-0000017-X · letter produced · email and SMS sent', '1 Aug 2026, 12:00'],
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
    ).toEqual([
      'Issued R · letter produced · email and SMS sent',
      'Reminder sent by email and SMS (day 20)',
      'Marked overdue',
    ]);
    expect(
      historyOf(
        { ...base, status: 'withdrawn', issuedAt: '2026-08-01T09:00:00Z', reference: 'R' },
        NOW,
      ).map((entry) => entry.title),
    ).toEqual([
      'Issued R · letter produced · email and SMS sent',
      'Withdrawn · letter revoked as issued in error',
    ]);
    expect(
      historyOf({ ...base, status: 'draft', issuedAt: null, dueAt: null, reference: null }, NOW),
    ).toEqual([]);
  });
});
