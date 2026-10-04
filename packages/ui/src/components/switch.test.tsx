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

  it('stays focusable when blocked with a reason, but does not change', () => {
    const change = vi.fn();
    render(
      <Switch
        checked={false}
        onCheckedChange={change}
        label="Compare"
        blockedReason="First declaration on Adili: nothing to compare."
      />,
    );
    const control = screen.getByRole('switch', { name: 'Compare' });
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect((control as HTMLButtonElement).disabled).toBe(false);
    expect(control.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('First declaration on Adili: nothing to compare.');
    fireEvent.click(control);
    expect(change).not.toHaveBeenCalled();
  });

  it("keeps the caller's description beside the reason, and reads as off while blocked", () => {
    render(
      <>
        <span id="hint">Compares items by type and description.</span>
        <Switch
          checked
          onCheckedChange={() => undefined}
          label="Compare"
          aria-describedby="hint"
          blockedReason="Nothing to compare."
        />
      </>,
    );
    const control = screen.getByRole('switch', { name: 'Compare' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    const ids = (control.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toContain('hint');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(
      'Nothing to compare.',
    );
  });

  it('is not blocked by an empty reason', () => {
    const change = vi.fn();
    render(<Switch checked={false} onCheckedChange={change} label="Compare" blockedReason="" />);
    const control = screen.getByRole('switch', { name: 'Compare' });
    expect(control.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(control);
    expect(change).toHaveBeenCalledWith(true);
  });

  it('stays blocked whatever aria-disabled the caller passes', () => {
    render(
      <Switch
        checked={false}
        onCheckedChange={() => undefined}
        label="Compare"
        aria-disabled={false}
        blockedReason="Nothing to compare."
      />,
    );
    expect(screen.getByRole('switch').getAttribute('aria-disabled')).toBe('true');
  });
});
