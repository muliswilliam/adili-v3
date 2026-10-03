// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './switch';

describe('Switch', () => {
  it('is a switch named by its label, saying its state beside it, described by the hint', () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        checked={false}
        onCheckedChange={onCheckedChange}
        label="Published"
        text="Not published"
        hint="Only staff can see it."
      />,
    );
    const control = screen.getByRole('switch', { name: 'Published' });
    expect(control).toHaveProperty('checked', false);
    expect(screen.getByText('Not published')).toBeTruthy();
    expect(control.getAttribute('aria-describedby')).toBe(
      screen.getByText('Only staff can see it.').id,
    );
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('can be disabled', () => {
    render(<Switch checked onCheckedChange={vi.fn()} label="Published" disabled />);
    expect(screen.getByRole('switch', { name: 'Published' })).toHaveProperty('disabled', true);
  });
});
