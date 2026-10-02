import { describe, expect, it } from 'vitest';

import { listLine, newClarificationBlock } from './list';

const base = {
  status: 'issued' as const,
  items: [{}, {}],
  issuedAt: '2026-09-08T09:00:00Z',
  dueAt: '2026-10-08T09:00:00Z',
  respondedAt: null,
  responseLate: false,
  resolvedAt: null,
};

describe('listLine', () => {
  it('says when it was issued and what is next', () => {
    expect(listLine(base)).toBe('Issued 8 Sep 2026 · due 8 Oct 2026');
    expect(
      listLine({
        ...base,
        status: 'responded',
        respondedAt: '2026-10-11T09:00:00Z',
        responseLate: true,
      }),
    ).toBe('Issued 8 Sep 2026 · responded 11 Oct 2026 (3 days late)');
    expect(
      listLine({
        ...base,
        status: 'resolved',
        respondedAt: '2026-09-20T09:00:00Z',
        resolvedAt: '2026-09-25T09:00:00Z',
      }),
    ).toBe('Issued 8 Sep 2026 · responded 20 Sep 2026 · resolved 25 Sep 2026');
    expect(listLine({ ...base, status: 'withdrawn' })).toBe('Issued 8 Sep 2026 · withdrawn');
  });

  it('says a draft is not sent, with its items', () => {
    expect(listLine({ ...base, status: 'draft', issuedAt: null, dueAt: null })).toBe(
      'Not sent · 2 items',
    );
  });
});

describe('newClarificationBlock', () => {
  const NOW = '2026-09-28T09:00:00Z';
  const me = { subject: 'me', name: 'Faith Achieng' };

  it('lets the reviewer holding the case compose while the window is open', () => {
    expect(
      newClarificationBlock({ assignee: me, windowEndsAt: '2026-10-02T09:00:00Z' }, 'me', NOW),
    ).toBeNull();
  });

  it('says why not: the window closed, someone else holds it, nobody does', () => {
    expect(
      newClarificationBlock({ assignee: me, windowEndsAt: '2026-09-02T09:00:00Z' }, 'me', NOW),
    ).toBe('The clarification window closed on 2 Sep 2026.');
    expect(
      newClarificationBlock(
        {
          assignee: { subject: 'peter', name: 'Peter Mwangi' },
          windowEndsAt: '2026-10-02T09:00:00Z',
        },
        'me',
        NOW,
      ),
    ).toBe('Only Peter Mwangi, who holds this case, can issue clarifications.');
    expect(
      newClarificationBlock({ assignee: null, windowEndsAt: '2026-10-02T09:00:00Z' }, 'me', NOW),
    ).toBe('Claim this case to issue a clarification.');
  });
});
