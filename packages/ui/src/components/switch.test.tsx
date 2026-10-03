import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from './switch';

describe('Switch', () => {
  it('is a switch named by its label, reporting whether it is on', () => {
    render(
      <Switch checked={false} onCheckedChange={() => undefined} label="Compare with version 1" />,
    );
    const control = screen.getByRole('switch', { name: 'Compare with version 1' });
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('asks to turn on when off, and off when on', () => {
    const change = vi.fn();
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={change} label="Compare" />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(change).toHaveBeenLastCalledWith(true);
    rerender(<Switch checked onCheckedChange={change} label="Compare" />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('switch'));
    expect(change).toHaveBeenLastCalledWith(false);
  });

  it('does nothing while disabled', () => {
    const change = vi.fn();
    render(<Switch checked={false} onCheckedChange={change} label="Compare" disabled />);
    fireEvent.click(screen.getByRole('switch'));
    expect(change).not.toHaveBeenCalled();
  });
});
