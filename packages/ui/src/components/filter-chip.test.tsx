import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FilterChip } from './filter-chip';

describe('FilterChip', () => {
  it('reports the pressed state and toggles it', () => {
    const onPressedChange = vi.fn();
    render(
      <FilterChip pressed={false} onPressedChange={onPressedChange} count={4} countLabel="records">
        Flagged only
      </FilterChip>,
    );
    const chip = screen.getByRole('button', { name: 'Flagged only 4 records' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(chip);
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it('turns off when pressed again', () => {
    const onPressedChange = vi.fn();
    render(
      <FilterChip pressed onPressedChange={onPressedChange}>
        Flagged only
      </FilterChip>,
    );
    const chip = screen.getByRole('button', { name: 'Flagged only' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(chip);
    expect(onPressedChange).toHaveBeenCalledWith(false);
  });
});
