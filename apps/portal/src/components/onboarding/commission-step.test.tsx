// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingCommission } from '../../server/directory/types';
import { matchCommissions } from './commission-picker';
import { CommissionStep } from './commission-step';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

const COMMISSIONS: OnboardingCommission[] = [
  { slug: 'jsc', issuerCode: 'JSC', name: 'Judicial Service Commission', hasRoster: false },
  { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission', hasRoster: true },
  { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission', hasRoster: true },
];

function search() {
  return screen.getByRole('combobox', { name: 'Responsible Commission' });
}

function continueButton() {
  return screen.getByRole('button', { name: 'Continue' });
}

beforeAll(() => {
  // jsdom does not lay out, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  navigate.mockReset();
});

describe('matchCommissions', () => {
  it('matches the name or the code, ignoring case', () => {
    expect(matchCommissions(COMMISSIONS, 'teach').map((entry) => entry.slug)).toEqual(['tsc']);
    expect(matchCommissions(COMMISSIONS, ' PSC ').map((entry) => entry.slug)).toEqual(['psc']);
    expect(matchCommissions(COMMISSIONS, '')).toHaveLength(3);
  });
});

describe('CommissionStep', () => {
  it('lists every Commission, marks those without a roster, and waits for a choice', () => {
    render(<CommissionStep commissions={COMMISSIONS} />);

    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: /Judicial/ }).textContent).toContain(
      'Roster not imported yet',
    );
    expect(continueButton().disabled).toBe(true);
  });

  it('says how to search when nothing matches', () => {
    render(<CommissionStep commissions={COMMISSIONS} />);

    fireEvent.change(search(), { target: { value: 'Police' } });

    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByText('No match for "Police". Try its short name, e.g. TSC.')).toBeDefined();
  });

  it('collapses to the chosen Commission and continues to Identify with it', () => {
    render(<CommissionStep commissions={COMMISSIONS} />);

    fireEvent.change(search(), { target: { value: 'tsc' } });
    fireEvent.keyDown(search(), { key: 'Enter' });

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Teachers Service Commission')).toBeDefined();
    expect(document.activeElement?.textContent).toContain('Change');

    fireEvent.click(continueButton());
    expect(navigate).toHaveBeenCalledWith({
      to: '/get-started/identify',
      search: { commission: 'tsc' },
    });
  });

  it('holds Continue for a Commission that has not imported its roster', () => {
    render(<CommissionStep commissions={COMMISSIONS} />);

    fireEvent.click(screen.getByRole('option', { name: /Judicial/ }));

    expect(screen.getByRole('alert').textContent).toContain(
      'Judicial Service Commission has not yet imported its roster.',
    );
    expect(continueButton().disabled).toBe(true);
  });

  it('reopens the search on Change and holds Continue until a choice is made', () => {
    render(<CommissionStep commissions={COMMISSIONS} preselected="psc" />);
    expect(continueButton().disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Change/ }));

    expect(document.activeElement).toBe(search());
    expect(continueButton().disabled).toBe(true);

    // Esc keeps the Commission already chosen.
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(screen.getByText('Public Service Commission')).toBeDefined();
    expect(continueButton().disabled).toBe(false);
  });

  it('says why the declarant is starting again', () => {
    render(<CommissionStep commissions={COMMISSIONS} notice="too-many" />);

    expect(screen.getAllByRole('alert')[0]?.textContent).toBe('Too many attempts. Start again.');
  });
});
