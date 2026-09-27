// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MOCK_COMMISSIONS } from '../../mocks/directory/fixtures';
import { DetailsCard, RosterCard } from './commission-cards';

const psc = MOCK_COMMISSIONS.find((item) => item.slug === 'psc');
if (!psc) throw new Error('fixture psc missing');

describe('DetailsCard', () => {
  it('lists the details in the spec order, starting with the name', () => {
    render(<DetailsCard commission={psc} />);
    const card = screen.getByRole('region', { name: 'Details' });
    const terms = within(card)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(terms).toEqual([
      'Name',
      'Commission key',
      'Issuer code',
      'Type',
      'Categories',
      'Policy version',
      'Created',
    ]);
    expect(within(card).getAllByRole('definition')[0]?.textContent).toBe(
      'Public Service Commission',
    );
    expect(within(card).getByText('Version 1, platform defaults')).toBeTruthy();
  });
});

describe('RosterCard', () => {
  it('is in its no-roster state in slice 01', () => {
    render(<RosterCard />);
    const card = screen.getByRole('region', { name: 'Roster' });
    expect(within(card).getByText('No roster yet')).toBeTruthy();
    expect(
      within(card).getByText(
        'The reporting officer imports the roster after activating their account.',
      ),
    ).toBeTruthy();
  });
});
