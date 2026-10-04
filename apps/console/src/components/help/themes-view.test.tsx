// @vitest-environment jsdom
import { TooltipProvider } from '@adili/ui';
import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { QuestionThemeCount } from '../../server/declarations/client';
import { ThemesView } from './themes-view';
import { nth } from './test-router';

vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('./test-router')).TestLink,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

const ADMIN = { scope: { kind: 'commission', slug: 'psc' }, readOnly: false } as const;

const COUNTS: QuestionThemeCount[] = [
  { month: '2026-09', theme: 'household-spouses', count: 412, unanswered: 31 },
  { month: '2026-09', theme: 'land', count: 355, unanswered: 44 },
  { month: '2026-09', theme: 'vehicles', count: 214, unanswered: 12 },
  { month: '2026-08', theme: 'land', count: 277, unanswered: 34 },
];

function renderView(props: Partial<ComponentProps<typeof ThemesView>> = {}) {
  const onSearchChange = vi.fn();
  render(
    <TooltipProvider>
      <ThemesView
        workspace={ADMIN}
        result={{ ok: true, data: COUNTS }}
        search={{ month: '2026-09' }}
        onSearchChange={onSearchChange}
        thisMonth="2026-10"
        {...props}
      />
    </TooltipProvider>,
  );
  return { onSearchChange };
}

describe('question themes (spec 11 FE-4, S8)', () => {
  it("shows a month's questions, unanswered and the most unanswered theme", () => {
    renderView();
    const tiles = screen.getByRole('group', { name: 'September 2026 in numbers' });
    expect(within(tiles).getByText('981')).toBeTruthy();
    expect(within(tiles).getByText('87')).toBeTruthy();
    expect(within(tiles).getByText('9% of questions')).toBeTruthy();
    expect(within(tiles).getByText('Land and buildings · 44 of 355')).toBeTruthy();
    expect(
      screen.getByText(
        'Counts only, per month. Question text never leaves the declarations service.',
      ),
    ).toBeTruthy();
  });

  it('lists the themes most asked first, with totals and an unanswered row', () => {
    renderView();
    const table = screen.getByRole('table', {
      name: 'Question themes for September 2026, most asked first. Counts only.',
    });
    const rows = within(table).getAllByRole('row');
    expect(
      rows.map((row) => within(row).queryAllByRole('rowheader')[0]?.textContent ?? ''),
    ).toEqual([
      '',
      'Household and spouses',
      'Land and buildings',
      'Vehicles',
      'All themes',
      'Unanswered',
    ]);
    const unanswered = nth(rows, rows.length - 1);
    expect(within(unanswered).getByText('87')).toBeTruthy();
    expect(within(unanswered).getByRole('img', { name: '9% unanswered' })).toBeTruthy();
    expect(within(nth(rows, 1)).getByRole('img', { name: '42% of questions' })).toBeTruthy();
  });

  it('lets commission admins start an article for a theme', () => {
    renderView();
    const link = screen.getByRole('link', { name: 'Write an article about Land and buildings' });
    expect(link.getAttribute('href')).toBe('/help/articles/new?theme=land');
  });

  it('offers reporting officers the counts only', () => {
    renderView({ workspace: { ...ADMIN, readOnly: true } });
    expect(screen.queryByRole('link', { name: /Write an article/ })).toBeNull();
  });

  it('says when a month has no questions, this month to date by default', () => {
    renderView({ search: {} });
    expect(screen.getByText('No questions in October 2026')).toBeTruthy();
    expect(screen.getByRole('combobox').textContent).toContain('October 2026 (to date)');
  });

  it('shows a skeleton while loading and a retry when the load fails', () => {
    renderView({ result: null });
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    renderView({ result: { ok: false, error: { kind: 'unavailable', detail: null } } });
    expect(screen.getByText('Question themes could not be loaded.')).toBeTruthy();
  });
});
