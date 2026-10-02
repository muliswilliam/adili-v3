import { describe, expect, it } from 'vitest';

import type { DeclarantClarification } from '../server/review/types';
import {
  declarationTypeName,
  groupClarifications,
  homeClarifications,
  LIST_PAGE_SIZE,
  openCount,
  pageOf,
  rowOf,
} from './list';

const NOW = '2026-09-28T09:00:00Z';

const ITEM = { requirement: 'correct', text: 'Correct it.', label: 'Assets' } as const;

function clarification(overrides: Partial<DeclarantClarification> = {}): DeclarantClarification {
  return {
    id: 'c1a70000-0000-4000-8000-000000000001',
    caseId: 'ca5e0000-0000-4000-8000-000000000001',
    reference: 'CLR-TSC-2026-0000042-K',
    status: 'issued',
    items: [ITEM, ITEM, ITEM],
    issuedAt: '2026-09-16T09:00:00Z',
    dueAt: '2026-10-16T09:00:00Z',
    respondedAt: null,
    responseLate: false,
    resolvedAt: null,
    resolutionNote: null,
    letter: null,
    followUpOf: null,
    opening: null,
    openingAiJobId: null,
    language: 'en',
    response: null,
    commission: { slug: 'tsc', name: 'Teachers Service Commission' },
    declarationReference: 'DCI-TSC-2026-0003418-P',
    letterDownloadUrl: null,
    ...overrides,
  };
}

describe('declarationTypeName', () => {
  it('names the declaration from its reference prefix', () => {
    expect(declarationTypeName('DCI-TSC-2026-0003418-P')).toBe('initial declaration');
    expect(declarationTypeName('DCB-TSC-2027-0012345-A')).toBe('biennial declaration');
    expect(declarationTypeName('DCF-JSC-2028-0000042-4')).toBe('final declaration');
  });

  it('falls back to a plain "declaration" for anything else', () => {
    expect(declarationTypeName('CLR-TSC-2026-0000042-K')).toBe('declaration');
    expect(declarationTypeName('not a reference')).toBe('declaration');
  });
});

describe('rowOf', () => {
  it('describes an open clarification with its countdown', () => {
    expect(rowOf(clarification(), [], NOW)).toEqual({
      id: 'c1a70000-0000-4000-8000-000000000001',
      title: '3 points on your initial declaration',
      reference: 'CLR-TSC-2026-0000042-K',
      commission: 'Teachers Service Commission',
      dates: ['Issued 16 Sep 2026', 'due 16 Oct 2026'],
      kind: 'issued',
      status: { label: 'Open', variant: 'brand' },
      countdown: { text: 'Respond within 18 days', tone: 'neutral', overdue: false },
      tags: [],
    });
  });

  it('says one point, and the due day', () => {
    const row = rowOf(
      clarification({
        items: [ITEM],
        issuedAt: '2026-08-29T09:00:00Z',
        dueAt: '2026-09-28T09:00:00Z',
      }),
      [],
      NOW,
    );
    expect(row.title).toBe('1 point on your initial declaration');
    expect(row.countdown?.text).toBe('Respond by today');
  });

  it('puts the overdue days in the status, with no separate countdown', () => {
    const row = rowOf(
      clarification({
        status: 'overdue',
        issuedAt: '2026-08-12T09:00:00Z',
        dueAt: '2026-09-11T09:00:00Z',
      }),
      [],
      NOW,
    );
    expect(row.kind).toBe('overdue');
    expect(row.status).toEqual({ label: 'Overdue by 17 days', variant: 'destructive' });
    expect(row.countdown).toBeNull();
  });

  it('reads an issued clarification past its due date as overdue before the service flips it', () => {
    const row = rowOf(
      clarification({ issuedAt: '2026-08-27T09:00:00Z', dueAt: '2026-09-26T09:00:00Z' }),
      [],
      NOW,
    );
    expect(row.kind).toBe('overdue');
    expect(row.status.label).toBe('Overdue by 2 days');
  });

  it('notes the day-20 reminder while it is still open', () => {
    const row = rowOf(
      clarification({ issuedAt: '2026-09-04T09:00:00Z', dueAt: '2026-10-04T09:00:00Z' }),
      [],
      NOW,
    );
    expect(row.countdown).toMatchObject({ text: 'Respond within 6 days', tone: 'warning' });
    expect(row.tags).toEqual([
      { key: 'reminder', label: 'Reminder sent 24 Sep 2026', variant: 'default' },
    ]);
  });

  it('says when a response came, and how late', () => {
    const row = rowOf(
      clarification({
        status: 'responded',
        issuedAt: '2026-07-01T09:00:00Z',
        dueAt: '2026-07-31T09:00:00Z',
        respondedAt: '2026-08-06T09:00:00Z',
        responseLate: true,
      }),
      [],
      NOW,
    );
    expect(row.dates).toEqual(['Issued 1 Jul 2026', 'responded 6 Aug 2026']);
    expect(row.status).toEqual({ label: 'Responded', variant: 'info' });
    expect(row.countdown).toBeNull();
    expect(row.tags).toEqual([{ key: 'late', label: 'Responded 6 days late', variant: 'warning' }]);
  });

  it('says when it was resolved', () => {
    const row = rowOf(
      clarification({
        status: 'resolved',
        issuedAt: '2026-05-12T09:00:00Z',
        dueAt: '2026-06-11T09:00:00Z',
        respondedAt: '2026-06-01T09:00:00Z',
        resolvedAt: '2026-06-26T09:00:00Z',
      }),
      [],
      NOW,
    );
    expect(row.dates).toEqual(['Issued 12 May 2026', 'resolved 26 Jun 2026']);
    expect(row.status).toEqual({ label: 'Resolved', variant: 'success' });
    expect(row.tags).toEqual([]);
  });

  it('says a withdrawn one was withdrawn (the contract has no date for it)', () => {
    const row = rowOf(clarification({ status: 'withdrawn' }), [], NOW);
    expect(row.dates).toEqual(['Issued 16 Sep 2026', 'withdrawn']);
    expect(row.status).toEqual({ label: 'Withdrawn', variant: 'default' });
    expect(row.countdown).toBeNull();
  });

  it('marks a further clarification, and one that was followed up', () => {
    const original = clarification({
      id: 'c1a70000-0000-4000-8000-000000000005',
      status: 'responded',
      respondedAt: '2026-09-19T09:00:00Z',
    });
    const further = clarification({ followUpOf: original.id, items: [ITEM] });
    const all = [original, further];
    expect(rowOf(further, all, NOW).tags).toEqual([
      { key: 'follow-up', label: 'Further clarification', variant: 'default' },
    ]);
    expect(rowOf(original, all, NOW).tags).toEqual([
      { key: 'further-sent', label: 'Further clarification sent', variant: 'brand' },
    ]);
  });

  it('names a biennial declaration from its reference', () => {
    const row = rowOf(clarification({ declarationReference: 'DCB-TSC-2024-0001207-3' }), [], NOW);
    expect(row.title).toBe('3 points on your biennial declaration');
  });
});

describe('groupClarifications', () => {
  const open = clarification({ id: 'open', dueAt: '2026-10-16T09:00:00Z' });
  const overdue = clarification({
    id: 'overdue',
    status: 'overdue',
    issuedAt: '2026-08-12T09:00:00Z',
    dueAt: '2026-09-11T09:00:00Z',
  });
  const responded = clarification({
    id: 'responded',
    status: 'responded',
    issuedAt: '2026-08-01T09:00:00Z',
  });
  const resolved = clarification({
    id: 'resolved',
    status: 'resolved',
    issuedAt: '2026-05-01T09:00:00Z',
  });
  const withdrawn = clarification({
    id: 'withdrawn',
    status: 'withdrawn',
    issuedAt: '2026-09-01T09:00:00Z',
  });

  it('puts what needs a response first, soonest due first, then the rest, newest first', () => {
    const groups = groupClarifications([resolved, open, withdrawn, overdue, responded]);
    expect(groups.open.map((each) => each.id)).toEqual(['overdue', 'open']);
    expect(groups.earlier.map((each) => each.id)).toEqual(['withdrawn', 'responded', 'resolved']);
  });

  it('counts the ones that need a response', () => {
    expect(openCount([resolved, open, overdue])).toBe(2);
    expect(openCount([])).toBe(0);
  });
});

describe('pageOf', () => {
  const list = Array.from({ length: 7 }, (_, n) => n + 1);

  it('takes a page of five', () => {
    expect(LIST_PAGE_SIZE).toBe(5);
    expect(pageOf(list, 1)).toEqual({ page: 1, rows: [1, 2, 3, 4, 5] });
    expect(pageOf(list, 2)).toEqual({ page: 2, rows: [6, 7] });
  });

  it('keeps a page number past the end on the last page', () => {
    expect(pageOf(list, 9)).toEqual({ page: 2, rows: [6, 7] });
    expect(pageOf([], 3)).toEqual({ page: 1, rows: [] });
  });
});

describe('homeClarifications', () => {
  const open = clarification({ id: 'open' });
  const older = (id: string, issuedAt: string) =>
    clarification({ id, status: 'resolved', issuedAt });

  it('lists the ones that need a response', () => {
    const list = [older('a', '2026-05-01T09:00:00Z'), open];
    expect(homeClarifications(list).map((each) => each.id)).toEqual(['open']);
  });

  it('shows the two latest when none needs a response', () => {
    const list = [
      older('a', '2026-05-01T09:00:00Z'),
      older('b', '2026-07-01T09:00:00Z'),
      older('c', '2026-06-01T09:00:00Z'),
    ];
    expect(homeClarifications(list).map((each) => each.id)).toEqual(['b', 'c']);
  });
});
