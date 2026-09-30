import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StatTile } from './stat-tile';

const breakdown = [
  { label: 'Initial', value: 41 },
  { label: 'Biennial', value: 48298 },
  { label: 'Final', value: 6 },
];

describe('StatTile', () => {
  it('shows the label and the value with thousands separators', () => {
    render(<StatTile label="Upcoming" value={48345} />);

    screen.getByText('Upcoming');
    screen.getByText('48,345');
  });

  it('lists the breakdown on the tile, so it is reachable without hover', () => {
    render(<StatTile label="Upcoming" value={48345} breakdown={breakdown} />);

    const list = screen.getByRole('list', { name: 'Upcoming by type' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Initial41',
      'Biennial48,298',
      'Final6',
    ]);
  });

  it('also puts the breakdown in the hover title', () => {
    const { container } = render(<StatTile label="Due" value={47} breakdown={breakdown} />);

    expect(container.firstElementChild?.getAttribute('title')).toBe(
      'Due: Initial 41, Biennial 48,298, Final 6',
    );
  });

  it('names the breakdown list when given a label', () => {
    render(
      <StatTile
        label="Due or overdue but not onboarded"
        value={48}
        breakdown={[
          { label: 'Due', value: 29 },
          { label: 'Overdue', value: 19 },
        ]}
        breakdownLabel="Not onboarded by status"
      />,
    );

    screen.getByRole('list', { name: 'Not onboarded by status' });
  });

  it('shows a description under the value', () => {
    render(<StatTile label="Overdue" value={26} description="Since 31 Dec 2027" />);

    screen.getByText('Since 31 Dec 2027');
  });

  it('is a static panel without onPressedChange', () => {
    render(<StatTile label="Due" value={47} breakdown={breakdown} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('toggles as a filter, named by its label and value, with the breakdown outside the button', () => {
    const onPressedChange = vi.fn();
    const { rerender } = render(
      <StatTile
        label="Overdue"
        value={26}
        breakdown={breakdown}
        pressed={false}
        onPressedChange={onPressedChange}
      />,
    );

    const button = screen.getByRole('button', { name: 'Overdue 26' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(within(button).queryByRole('list')).toBeNull();

    fireEvent.click(button);
    expect(onPressedChange).toHaveBeenCalledWith(true);

    rerender(
      <StatTile
        label="Overdue"
        value={26}
        breakdown={breakdown}
        pressed
        onPressedChange={onPressedChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'Overdue 26' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onPressedChange).toHaveBeenLastCalledWith(false);
  });

  it('marks the warning tone', () => {
    const { container } = render(<StatTile label="Not onboarded" value={48} tone="warning" />);

    expect(container.firstElementChild?.getAttribute('data-tone')).toBe('warning');
  });
});
