// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MOCK_CLARIFICATION_IDS as IDS,
  mockClarification,
  resetReviewMock,
} from '../../server/review/mock.server';
import type { DeclarantClarification } from '../../server/review/types';
import { ClarificationsCard } from '../dashboard/clarifications-card';
import {
  ClarificationsSkeleton,
  ClarificationsView,
  type ClarificationsViewProps,
} from './clarification-list';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();

function fixtures(): DeclarantClarification[] {
  return Object.values(IDS).map((id) => {
    const found = mockClarification(id);
    if (!found) throw new Error(id);
    return found;
  });
}

function renderView(props: Partial<ClarificationsViewProps> = {}) {
  const onPage = vi.fn();
  const onRetry = vi.fn();
  render(
    <ClarificationsView
      result={{ status: 'ok', clarifications: fixtures() }}
      now={NOW}
      page={1}
      onPage={onPage}
      onRetry={onRetry}
      {...props}
    />,
  );
  return { onPage, onRetry };
}

function group(name: string) {
  return screen.getByRole('region', { name });
}

function rowTitles(region: HTMLElement) {
  return within(region)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent);
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  resetReviewMock(NOW_MS);
  // jsdom does not lay out, so it has no scrollIntoView.
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

describe('ClarificationsView', () => {
  it('lists what needs a response, soonest due first, each linking to its page', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1, name: 'Clarifications' })).toBeTruthy();
    const open = group('Needs your response');
    expect(rowTitles(open)).toEqual([
      '1 point on your initial declaration',
      '1 point on your initial declaration',
      '2 points on your initial declaration',
      '1 point on your initial declaration',
    ]);
    const links = within(open).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/clarifications/${IDS.overdue}`,
      `/clarifications/${IDS.reminder}`,
      `/clarifications/${IDS.open}`,
      `/clarifications/${IDS.further}`,
    ]);

    const [overdue, reminder, open8] = links as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(overdue).getByText('Overdue by 3 days')).toBeTruthy();
    expect(within(reminder).getByText('Respond within 8 days')).toBeTruthy();
    expect(within(reminder).getByText('Reminder sent 26 Sep 2026')).toBeTruthy();
    expect(within(open8).getByText('Respond within 22 days')).toBeTruthy();
    expect(within(open8).getByText('Open')).toBeTruthy();
    expect(
      within(open8).getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent === 'Issued 20 Sep 2026 · due 20 Oct 2026',
      ),
    ).toBeTruthy();
    expect(within(open8).getByText('CLR-TSC-2026-0000042-K')).toBeTruthy();
    expect(within(open8).getByText(/Teachers Service Commission/)).toBeTruthy();
  });

  it('pages the earlier ones, newest first, five at a time', () => {
    const { onPage } = renderView();
    const earlier = group('Earlier');
    expect(within(earlier).getAllByRole('link')).toHaveLength(5);
    expect(within(earlier).getByText('Withdrawn')).toBeTruthy();
    expect(within(earlier).getByText('Responded 3 days late')).toBeTruthy();
    expect(within(earlier).getByText('Further clarification sent')).toBeTruthy();

    const pages = within(earlier).getByRole('navigation', {
      name: 'Pages of your earlier clarifications',
    });
    expect(pages.textContent).toContain('1-5 of 7');
    fireEvent.click(within(pages).getByRole('button', { name: 'Page 2' }));
    expect(onPage).toHaveBeenCalledWith(2);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('shows the last earlier ones on page 2, from the biennial declaration', () => {
    renderView({ page: 2 });
    const earlier = group('Earlier');
    expect(rowTitles(earlier)).toEqual([
      '1 point on your biennial declaration',
      '1 point on your biennial declaration',
    ]);
    expect(within(earlier).getByText(/^6-7 of 7/)).toBeTruthy();
    expect(within(earlier).getAllByText(/^resolved|· resolved/).length).toBeGreaterThan(0);
    expect(within(earlier).getByText('Responded 6 days late')).toBeTruthy();
  });

  it('calls them all clarifications when none needs a response, without a pager for few', () => {
    const closed = fixtures()
      .filter((each) => each.status === 'resolved')
      .slice(0, 2);
    renderView({ result: { status: 'ok', clarifications: closed } });
    expect(screen.queryByRole('region', { name: 'Needs your response' })).toBeNull();
    expect(within(group('All clarifications')).getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('says when there are none, and how one would arrive', () => {
    renderView({ result: { status: 'ok', clarifications: [] } });
    expect(screen.getByRole('heading', { name: 'No clarification requests' })).toBeTruthy();
    expect(
      screen.getByText(
        'If one arrives, we will SMS and email you. You will have 30 days to respond.',
      ),
    ).toBeTruthy();
  });

  it('offers to try again when the list could not load', () => {
    const { onRetry } = renderView({ result: { status: 'unavailable' } });
    expect(
      screen.getByRole('heading', { name: 'We could not load your clarifications' }),
    ).toBeTruthy();
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('ClarificationsSkeleton', () => {
  it('marks the list as loading', () => {
    render(<ClarificationsSkeleton />);
    const status = screen.getByRole('status', { name: 'Loading your clarifications' });
    expect(status.getAttribute('aria-busy')).toBe('true');
  });
});

describe('ClarificationsCard', () => {
  it('lists the ones needing a response, with View all', () => {
    render(<ClarificationsCard clarifications={fixtures()} now={NOW} />);
    const card = screen.getByRole('region', { name: 'Clarifications' });
    expect(within(card).getByRole('link', { name: 'View all clarifications' })).toBeTruthy();
    const rows = within(card)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/clarifications/'));
    expect(rows).toHaveLength(4);
    expect(within(card).queryByText('Resolved')).toBeNull();
  });
});
