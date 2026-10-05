// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { HelpArticle, HelpPassage } from '../../server/declarations/client';
import { ArticlesView } from './articles-view';
import { type HelpSession, HelpSessionContext } from './scope';
import { nth } from './test-router';

vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('./test-router')).TestLink,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

const TODAY = '2026-10-03';
const COMMISSION = { scope: { kind: 'commission', slug: 'psc' }, readOnly: false } as const;
/** A platform admin's choice who is also the PSC's administrator. */
const BOTH_SCOPES = [
  { kind: 'platform', label: 'Platform' },
  { kind: 'commission', label: 'Public Service Commission' },
] as const;

const article = (n: number, patch: Partial<HelpArticle> = {}): HelpArticle => ({
  id: `0199c0de-a000-7000-8000-${String(n).padStart(12, '0')}`,
  tenant: 'psc',
  title: `Article ${String(n)}`,
  bodyEn: 'Text.',
  bodySw: null,
  tags: ['bio'],
  effectiveFrom: '2026-07-01',
  effectiveTo: null,
  published: true,
  version: 1,
  updatedAt: `2026-09-${String(30 - n).padStart(2, '0')}T08:00:00.000Z`,
  ...patch,
});

const ARTICLES = [
  article(1, { title: 'File numbers: where to find yours', bodySw: 'Nambari.', version: 3 }),
  article(2, { title: 'Housing Scheme Fund loans', tags: ['statement', 'mortgage'] }),
  article(3, { title: 'Acting appointments', published: false }),
  article(4, { title: 'Car Loan Scheme', effectiveFrom: '2026-11-01' }),
  article(5, { title: 'Interim guidance', effectiveFrom: '2025-11-01', effectiveTo: '2026-06-30' }),
  ...Array.from({ length: 8 }, (_, index) => article(index + 6)),
];

function renderView(
  props: Partial<ComponentProps<typeof ArticlesView>> = {},
  session?: Partial<HelpSession>,
) {
  const onSearchChange = vi.fn();
  const searchAsDeclarants = vi.fn<HelpSession['searchAsDeclarants']>();
  const value: HelpSession = {
    justPublished: null,
    setJustPublished: vi.fn(),
    searchAsDeclarants,
    onUnauthenticated: vi.fn(),
    scopes: [],
    chooseScope: vi.fn(),
    ...session,
  };
  render(
    <ToastProvider>
      <TooltipProvider>
        <HelpSessionContext value={value}>
          <ArticlesView
            workspace={COMMISSION}
            result={{ ok: true, data: ARTICLES }}
            search={{}}
            onSearchChange={onSearchChange}
            today={TODAY}
            {...props}
          />
        </HelpSessionContext>
      </TooltipProvider>
    </ToastProvider>,
  );
  return { onSearchChange, searchAsDeclarants };
}

describe('help articles list (spec 11 FE-4)', () => {
  it('lists the first 10 articles with status, languages, period in force and version', () => {
    renderView();
    const table = screen.getByRole('table', { name: 'Help articles, most recently updated first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    const first = nth(rows, 0);
    expect(
      within(first).getByRole('link', { name: 'File numbers: where to find yours' }),
    ).toHaveProperty(
      'href',
      expect.stringContaining('/help/articles/0199c0de-a000-7000-8000-000000000001'),
    );
    expect(within(first).getByText('Published')).toBeTruthy();
    expect(within(first).getByRole('img', { name: 'English and Kiswahili' })).toBeTruthy();
    expect(within(first).getByText('From 1 Jul 2026')).toBeTruthy();
    expect(within(first).getByText('Version 3')).toBeTruthy();
    expect(within(nth(rows, 1)).getByText('Financial statement, Mortgage')).toBeTruthy();
    expect(within(nth(rows, 1)).getByRole('img', { name: 'English only' })).toBeTruthy();
    expect(within(nth(rows, 2)).getByText('Draft')).toBeTruthy();
    expect(within(nth(rows, 3)).getByText('Scheduled')).toBeTruthy();
    expect(within(nth(rows, 4)).getByText('Expired')).toBeTruthy();
    expect(within(nth(rows, 4)).getByText('1 Nov 2025 - 30 Jun 2026')).toBeTruthy();
    expect(screen.getByText('Showing 1-10 of 13')).toBeTruthy();
  });

  it('counts each status on its filter chip and filters by one', () => {
    const { onSearchChange } = renderView();
    const filters = screen.getByRole('group', { name: 'Status' });
    expect(
      within(filters)
        .getByRole('button', { name: /^All 13/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(within(filters).getByRole('button', { name: /^Draft 1/ }));
    expect(onSearchChange).toHaveBeenCalledWith({ q: undefined, status: 'draft', page: undefined });
  });

  it('shows page 2 and goes back', () => {
    const { onSearchChange } = renderView({ search: { page: 2 } });
    expect(screen.getByText('Showing 11-13 of 13')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onSearchChange).toHaveBeenCalledWith({ page: undefined });
  });

  it('says when nothing matches, with a way to clear the filters', () => {
    const { onSearchChange } = renderView({ search: { q: 'pension scheme abroad' } });
    expect(screen.getByText('No matches')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onSearchChange).toHaveBeenCalledWith({});
  });

  it('offers a first article when there are none', () => {
    renderView({ result: { ok: true, data: [] } });
    expect(screen.getByText('No help articles yet')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'New article' })).toHaveLength(2);
  });

  it('shows a skeleton while loading and a retry when the load fails', () => {
    renderView({ result: null });
    expect(
      screen
        .getByRole('table', { name: 'Help articles, most recently updated first' })
        .getAttribute('aria-busy'),
    ).toBe('true');
    renderView({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });
    expect(screen.getByText('Help articles could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('is read only for reporting officers: no new article, a read-only badge', () => {
    renderView({ workspace: { ...COMMISSION, readOnly: true } });
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'New article' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Question themes' })).toBeTruthy();
  });

  it('labels the tabs for platform admins: platform articles and the legal corpus', () => {
    renderView({ workspace: { scope: { kind: 'platform' }, readOnly: false } });
    const tabs = screen.getByRole('navigation', { name: 'Help pages' });
    expect(
      within(tabs).getByRole('link', { name: 'Platform articles' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(within(tabs).getByRole('link', { name: 'Legal corpus' })).toBeTruthy();
  });

  it('offers no choice of help to a viewer who may open only one', () => {
    renderView({}, { scopes: [{ kind: 'commission', label: 'Public Service Commission' }] });
    expect(screen.queryByRole('group', { name: 'Whose help' })).toBeNull();
  });

  it("lets a platform admin with a Commission role switch to the Commission's help", () => {
    const chooseScope = vi.fn();
    renderView(
      { workspace: { scope: { kind: 'platform' }, readOnly: false } },
      {
        scopes: BOTH_SCOPES,
        chooseScope,
      },
    );
    const choice = screen.getByRole('group', { name: 'Whose help' });
    expect(within(choice).getByRole('radio', { name: 'Platform' })).toHaveProperty('checked', true);
    fireEvent.click(within(choice).getByRole('radio', { name: 'Public Service Commission' }));
    expect(chooseScope).toHaveBeenCalledWith('commission');
  });

  it("keeps a platform admin who is the Commission's reporting officer read only there", () => {
    renderView({ workspace: { ...COMMISSION, readOnly: true } }, { scopes: BOTH_SCOPES });
    expect(screen.getByRole('group', { name: 'Whose help' })).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'New article' })).toBeNull();
  });

  it("shows the Commission's tabs once the Commission's help is chosen", () => {
    renderView({}, { scopes: BOTH_SCOPES });
    const choice = screen.getByRole('group', { name: 'Whose help' });
    expect(within(choice).getByRole('radio', { name: 'Public Service Commission' })).toHaveProperty(
      'checked',
      true,
    );
    const tabs = screen.getByRole('navigation', { name: 'Help pages' });
    expect(within(tabs).getByRole('link', { name: 'Question themes' })).toBeTruthy();
    expect(within(tabs).queryByRole('link', { name: 'Legal corpus' })).toBeNull();
  });
});

describe('test help search (S9: a published article is found in the same session)', () => {
  const passages: HelpPassage[] = [
    {
      id: ARTICLES[2]?.id ?? '',
      source: 'help',
      citation: 'Help: Acting appointments',
      title: 'Acting appointments',
      snippet: 'An acting appointment does not create a new filing obligation.',
      language: 'en',
    },
    {
      id: 'c1',
      source: 'act',
      citation: 'Act s.34',
      title: 'Initial declaration',
      snippet: 'Within thirty days of appointment.',
      language: 'en',
    },
  ];

  it("searches as the Commission's declarants and marks the article just published", async () => {
    const searchAsDeclarants = vi.fn<HelpSession['searchAsDeclarants']>(() =>
      Promise.resolve({ ok: true, data: passages }),
    );
    renderView({}, { searchAsDeclarants, justPublished: passages[0]?.id ?? null });
    fireEvent.click(screen.getByRole('button', { name: 'Test help search' }));
    const drawer = await screen.findByRole('dialog', { name: 'Test help search' });
    expect(within(drawer).getByText(/the way your Commission's declarants would/)).toBeTruthy();
    fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'acting appointment' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Search' }));
    expect(await within(drawer).findByText('Just published')).toBeTruthy();
    // One live region, mounted with the drawer, announces the count only.
    const status = within(drawer).getByRole('status');
    expect(status.textContent).toBe('2 results');
    expect(drawer.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(1);
    expect(searchAsDeclarants).toHaveBeenCalledWith({
      scope: { kind: 'commission', slug: 'psc' },
      q: 'acting appointment',
      language: 'en',
    });
    expect(within(drawer).getByText('Help: Acting appointments')).toBeTruthy();
    expect(within(drawer).getByText('Act s.34')).toBeTruthy();
    expect(within(drawer).getAllByText('appointment', { selector: 'mark' }).length).toBeGreaterThan(
      0,
    );
  });

  it('says what declarants would see when nothing is found, and when search fails', async () => {
    const searchAsDeclarants = vi
      .fn<HelpSession['searchAsDeclarants']>()
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } });
    renderView({}, { searchAsDeclarants });
    fireEvent.click(screen.getByRole('button', { name: 'Test help search' }));
    const drawer = await screen.findByRole('dialog', { name: 'Test help search' });
    const box = within(drawer).getByRole('searchbox', { name: 'Search' });
    fireEvent.change(box, { target: { value: 'x' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Search' }));
    expect(within(drawer).getByText('Type at least 2 characters.')).toBeTruthy();
    expect(searchAsDeclarants).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'helicopter' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Search' }));
    expect(
      await within(drawer).findByText('Declarants would see "Ask your reporting officer".'),
    ).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      expect(
        within(drawer).getByText('Search is not available right now. Try again in a moment.'),
      ).toBeTruthy();
    });
  });
});
