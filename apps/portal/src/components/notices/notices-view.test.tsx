// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import createClient from 'openapi-fetch';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMyNotices, type MyNoticesResult } from '../../server/notices.server';
import { mockReviewFetch, resetReviewMock } from '../../server/review/mock.server';
import { MOCK_NOTICE_IDS as IDS } from '../../server/review/notices-mock.server';
import type { paths } from '../../server/review/schema.gen';
import { NoticesSkeleton, NoticesView } from './notices-view';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a href={to.replace('$actionId', params?.actionId ?? '')} {...props}>
      {children}
    </a>
  ),
}));

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();
const client = createClient<paths>({ baseUrl: 'http://review.test', fetch: mockReviewFetch });

async function loaded(): Promise<MyNoticesResult> {
  return loadMyNotices(client);
}

beforeEach(() => {
  resetReviewMock(NOW_MS);
});
afterEach(cleanup);

describe('NoticesView (S17)', () => {
  it('lists the notices, newest first, with act-by dates and statuses', async () => {
    render(
      <NoticesView result={await loaded()} now={NOW} page={1} onPage={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Notices' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Notices' });
    const rows = within(list).getAllByRole('link');
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      `/notices/${IDS.warning}`,
      `/notices/${IDS.noticeOpen}`,
      `/notices/${IDS.noticeResponded}`,
      `/notices/${IDS.complied}`,
    ]);
    const [warning, open, responded, complied] = rows;
    if (!warning || !open || !responded || !complied) throw new Error('rows');
    expect(within(warning).getByText('Warning')).toBeTruthy();
    expect(within(warning).getByText(/ADM-TSC-2026-0000301-L/)).toBeTruthy();
    expect(within(warning).getByText('Act by 10 Oct 2026 · 12 days left')).toBeTruthy();
    expect(within(open).getByText('Act by 7 Oct 2026 · 9 days left')).toBeTruthy();
    expect(within(responded).getByText('Responded')).toBeTruthy();
    expect(within(responded).getByText('Followed by a warning')).toBeTruthy();
    expect(within(complied).getByText('Complied')).toBeTruthy();
  });

  it('puts the nearest act-by date on top, with the way to comply', async () => {
    render(
      <NoticesView result={await loaded()} now={NOW} page={1} onPage={vi.fn()} onRetry={vi.fn()} />,
    );
    const banner = screen.getByRole('status');
    expect(within(banner).getByText('Act by 7 Oct 2026.')).toBeTruthy();
    expect(within(banner).getByText('File your biennial declaration 2026.')).toBeTruthy();
    expect(
      within(banner)
        .getByRole('link', { name: /File declaration/ })
        .getAttribute('href'),
    ).toBe('/');
    const steps = screen.getByRole('list', { name: 'Administrative action steps' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((step) => step.textContent),
    ).toEqual([
      'NoticeCurrent',
      'WarningNot issued',
      'StoppageNot issued',
      'DisciplinaryNot issued',
    ]);
  });

  it('says when there are no notices', () => {
    render(
      <NoticesView
        result={{ status: 'ok', notices: [] }}
        now={NOW}
        page={1}
        onPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('No notices')).toBeTruthy();
    expect(
      screen.getByText(
        'Notices are sent only when a declaration or a clarification response is overdue.',
      ),
    ).toBeTruthy();
  });

  it('offers a retry when the notices could not load', () => {
    const onRetry = vi.fn();
    render(
      <NoticesView
        result={{ status: 'unavailable' }}
        now={NOW}
        page={1}
        onPage={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('We could not load your notices')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('links back to Home, loaded or not (#742)', () => {
    render(
      <NoticesView
        result={{ status: 'unavailable' }}
        now={NOW}
        page={1}
        onPage={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
    cleanup();
    render(<NoticesSkeleton />);
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
  });

  it('shows placeholder rows while loading', () => {
    render(<NoticesSkeleton />);
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });
});
