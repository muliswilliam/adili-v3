import { describe, expect, it } from 'vitest';

import type { DeclarantClarification } from '../server/review/types';
import { historyOf, periodOf } from './view';

const NOW = '2026-09-28T09:00:00Z';

function clarification(overrides: Partial<DeclarantClarification> = {}): DeclarantClarification {
  return {
    id: 'c1a70000-0000-4000-8000-000000000001',
    caseId: 'ca5e0000-0000-4000-8000-000000000001',
    reference: 'CLR-TSC-2026-0000042-K',
    status: 'issued',
    items: [
      {
        sectionKey: null,
        personKey: null,
        itemId: null,
        requirement: 'correct',
        text: 'Correct it.',
        label: 'Assets',
        aiJobId: null,
        aiLanguage: null,
      },
    ],
    issuedAt: '2026-09-20T09:00:00Z',
    dueAt: '2026-10-20T09:00:00Z',
    respondedAt: null,
    responseLate: false,
    resolvedAt: null,
    resolutionNote: null,
    letter: {
      documentId: 'd0c00000-0000-4000-8000-000000000001',
      verificationId: 'V-1',
      status: 'issued',
    },
    followUpOf: null,
    opening: null,
    openingAiJobId: null,
    openingAiLanguage: null,
    language: 'en',
    response: null,
    commission: { slug: 'tsc', name: 'Teachers Service Commission' },
    declarationReference: 'DCI-TSC-2026-0003418-P',
    letterDownloadUrl: '/letter.pdf',
    ...overrides,
  };
}

describe('periodOf', () => {
  it('counts down an open clarification with the day of the period', () => {
    expect(periodOf(clarification(), NOW)).toEqual({
      title: 'Respond within 22 days',
      detail: 'Due 20 Oct 2026 · day\u00a08\u00a0of\u00a030',
      tone: 'neutral',
      progress: { day: 8, of: 30 },
    });
  });

  it('says a passed deadline can still be met, late', () => {
    const overdue = clarification({
      status: 'overdue',
      issuedAt: '2026-08-20T09:00:00Z',
      dueAt: '2026-09-19T09:00:00Z',
    });
    expect(periodOf(overdue, NOW)).toMatchObject({
      title: 'Overdue by 9 days',
      detail: 'Was due 19 Sep 2026. You can still respond.',
      tone: 'danger',
    });
  });

  it('says whether a response came on time or how late', () => {
    const late = clarification({
      status: 'responded',
      dueAt: '2026-09-19T09:00:00Z',
      respondedAt: '2026-09-22T10:00:00Z',
      responseLate: true,
    });
    expect(periodOf(late, NOW)).toMatchObject({
      title: 'Responded 3 days late',
      detail: 'Response submitted 22 Sep 2026, 13:00 · due 19 Sep 2026',
      tone: 'warning',
      progress: null,
    });
    const onTime = clarification({ status: 'resolved', respondedAt: '2026-09-25T10:00:00Z' });
    expect(periodOf(onTime, NOW).title).toBe('Responded on time');
  });

  it('needs no response once withdrawn', () => {
    expect(periodOf(clarification({ status: 'withdrawn' }), NOW)).toMatchObject({
      title: 'No response needed',
      progress: null,
    });
  });
});

describe('historyOf', () => {
  it('lists issue, the day-20 reminder and the due date of an open clarification', () => {
    const open = clarification({ issuedAt: '2026-09-01T09:00:00Z', dueAt: '2026-10-01T09:00:00Z' });
    expect(historyOf(open, [], NOW).map((entry) => [entry.title, entry.detail])).toEqual([
      ['Issued by Teachers Service Commission', '1 Sep 2026, 12:00'],
      ['Reminder sent', '21 Sep 2026'],
      ['Response due', '1 Oct 2026'],
    ]);
  });

  it('records a late response, the follow-up and resolution', () => {
    const late = clarification({
      status: 'resolved',
      issuedAt: '2026-08-01T09:00:00Z',
      dueAt: '2026-08-31T09:00:00Z',
      respondedAt: '2026-09-03T09:00:00Z',
      responseLate: true,
      resolvedAt: '2026-09-10T09:00:00Z',
    });
    expect(
      historyOf(late, [{ id: 'x', reference: 'CLR-TSC-2026-0000045-P' }], NOW).map(
        (entry) => entry.title,
      ),
    ).toEqual([
      'Issued by Teachers Service Commission',
      'Reminder sent',
      'Due date passed',
      'You responded (3 days late)',
      'Further clarification sent',
      'Resolved',
    ]);
  });

  it('shows no reminder once the declarant answered before day 20, nor for a withdrawal', () => {
    const early = clarification({
      status: 'responded',
      issuedAt: '2026-08-01T09:00:00Z',
      dueAt: '2026-08-31T09:00:00Z',
      respondedAt: '2026-08-05T09:00:00Z',
    });
    expect(historyOf(early, [], NOW).map((entry) => entry.title)).toEqual([
      'Issued by Teachers Service Commission',
      'You responded',
    ]);
    const withdrawn = clarification({ status: 'withdrawn', issuedAt: '2026-08-01T09:00:00Z' });
    expect(historyOf(withdrawn, [], NOW).map((entry) => entry.title)).toEqual([
      'Issued by Teachers Service Commission',
      'Withdrawn: issued in error',
    ]);
  });
});
