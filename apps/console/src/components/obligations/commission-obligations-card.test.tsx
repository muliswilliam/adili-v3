// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type {
  CommissionObligationsSummary,
  DeclarationsResult,
} from '../../server/declarations/client';
import { CommissionObligationsCard } from './commission-obligations-card';

const counts = (upcoming = 0, due = 0, overdue = 0, filed = 0, filedLate = 0) => ({
  upcoming,
  due,
  overdue,
  filed,
  filedLate,
});

/** A biennial cycle under the statutory dates. */
const cycle = (year: number, opened: boolean) => ({
  key: `biennial:${String(year)}`,
  statementDate: `${String(year)}-11-01`,
  dueDate: `${String(year)}-12-31`,
  opensOn: `${String(year)}-07-04`,
  opened,
});

function summary(
  overrides: Partial<CommissionObligationsSummary> = {},
): DeclarationsResult<CommissionObligationsSummary> {
  return {
    ok: true,
    data: {
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      cycle: cycle(2027, true),
      cycles: [cycle(2027, true), cycle(2029, false), cycle(2031, false)],
      total: counts(0, 47, 26),
      byType: { initial: counts(0, 40, 20), biennial: counts(), final: counts(0, 7, 6) },
      notOnboarded: { due: 30, overdue: 18 },
      ...overrides,
    },
  };
}

const values = (card: HTMLElement) =>
  within(card)
    .getAllByRole('definition')
    .map((dd) => `${dd.previousElementSibling?.textContent ?? ''} ${dd.textContent}`);

describe('FE-4 Commission obligations card (EACC, platform admin)', () => {
  it('shows the cycle and the four counts', () => {
    render(<CommissionObligationsCard summary={summary()} />);
    const card = screen.getByRole('region', { name: 'Obligations' });
    expect(card.textContent).toContain('Biennial 2027 · due 31 Dec 2027');
    expect(values(card)).toEqual(['Upcoming 0', 'Due 47', 'Overdue 26', 'Not onboarded 48']);
    // EACC gets counts only: no way to the declarant list.
    expect(within(card).queryByRole('link')).toBeNull();
  });

  it('offers the declarant list to platform admins', () => {
    render(
      <CommissionObligationsCard
        summary={summary()}
        link={<a href="/commissions/psc/obligations">Obligations</a>}
      />,
    );
    const card = screen.getByRole('region', { name: 'Obligations' });
    expect(within(card).getByRole('link', { name: 'Obligations' })).toBeTruthy();
  });

  it('says there are no obligations yet when every count is zero', () => {
    render(
      <CommissionObligationsCard
        summary={summary({ total: counts(), notOnboarded: { due: 0, overdue: 0 } })}
        link={<a href="/commissions/jsc/obligations">Obligations</a>}
      />,
    );
    const card = screen.getByRole('region', { name: 'Obligations' });
    expect(card.textContent).toContain('No obligations yet');
    expect(card.textContent).toContain(
      'Obligations appear when the roster is imported and a cycle opens.',
    );
    expect(within(card).queryByRole('link')).toBeNull();
  });

  it('says so when the counts could not be loaded, without failing the page', () => {
    render(
      <CommissionObligationsCard
        summary={{ ok: false, error: { kind: 'unavailable', detail: null } }}
      />,
    );
    const card = screen.getByRole('region', { name: 'Obligations' });
    expect(card.textContent).toContain('Obligation counts could not be loaded.');
  });
});
