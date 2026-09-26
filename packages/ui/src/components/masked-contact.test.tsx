import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MaskedContact, maskEmail, maskPhone } from './masked-contact';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('jane.doe@moe.go.ke')).toBe('j***@moe.go.ke');
    expect(maskEmail('j@moe.go.ke')).toBe('j***@moe.go.ke');
  });

  it('leaves an already masked value alone and hides a malformed one', () => {
    expect(maskEmail('j***@moe.go.ke')).toBe('j***@moe.go.ke');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('maskPhone', () => {
  it('shows Kenyan numbers in local format with the last three digits', () => {
    expect(maskPhone('+254712345678')).toBe('07** *** 678');
    expect(maskPhone('0712 345 678')).toBe('07** *** 678');
  });

  it('leaves an already masked value alone and hides a short one', () => {
    expect(maskPhone('07** *** 123')).toBe('07** *** 123');
    expect(maskPhone('123')).toBe('** *** ***');
  });
});

describe('MaskedContact', () => {
  it('never renders the full value', () => {
    const { container } = render(<MaskedContact kind="email" value="jane.doe@moe.go.ke" />);

    expect(container.textContent).not.toContain('jane.doe');
    expect(screen.getByText('j***@moe.go.ke')).toBeDefined();
  });

  it('tells screen reader users the value is partly hidden', () => {
    render(<MaskedContact kind="phone" value="+254712345678" />);

    const hint = screen.getByText('(partially hidden for privacy)');
    expect(hint.className).toContain('sr-only');
  });

  it('shows a verified badge when verified', () => {
    const { rerender } = render(<MaskedContact kind="phone" value="07** *** 123" />);
    expect(screen.queryByText('Verified')).toBeNull();

    rerender(<MaskedContact kind="phone" value="07** *** 123" verified />);
    expect(screen.getByText('Verified')).toBeDefined();
  });
});
