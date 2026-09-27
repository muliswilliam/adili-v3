// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  IdentityMismatchBadge,
  IdentityMismatchCallout,
  IdentityMismatchFilterChip,
} from './identity-mismatch';

describe('IdentityMismatchFilterChip', () => {
  it('is an unpressed toggle with the count of failed records', () => {
    render(<IdentityMismatchFilterChip pressed={false} onPressedChange={vi.fn()} count={3} />);

    const chip = screen.getByRole('button', { name: 'Identity check failed 3 records' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows as pressed while the filter is on', () => {
    render(<IdentityMismatchFilterChip pressed onPressedChange={vi.fn()} count={3} />);

    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves the count out when it is not known', () => {
    render(<IdentityMismatchFilterChip pressed={false} onPressedChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Identity check failed' })).toBeTruthy();
  });

  it('asks to flip the filter when clicked', () => {
    const onPressedChange = vi.fn();
    const { rerender } = render(
      <IdentityMismatchFilterChip pressed={false} onPressedChange={onPressedChange} />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(onPressedChange).toHaveBeenLastCalledWith(true);

    rerender(<IdentityMismatchFilterChip pressed onPressedChange={onPressedChange} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onPressedChange).toHaveBeenLastCalledWith(false);
  });
});

describe('IdentityMismatchBadge', () => {
  it('says the identity check failed in words, not colour alone', () => {
    render(<IdentityMismatchBadge />);

    expect(screen.getByText('Identity check failed')).toBeTruthy();
  });
});

describe('IdentityMismatchCallout', () => {
  it('says when the check failed and how to fix it', () => {
    render(<IdentityMismatchCallout at="2026-09-24T11:20:00Z" />);

    const callout = screen.getByRole('status');
    expect(callout.textContent).toContain('Identity check failed on 24 Sep 2026, 14:20.');
    expect(callout.textContent).toContain(
      'Name or national ID does not match the national register. Correct it in your next import.',
    );
  });
});
