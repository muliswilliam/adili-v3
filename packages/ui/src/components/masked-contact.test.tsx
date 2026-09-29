import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MaskedContact } from './masked-contact';

describe('MaskedContact', () => {
  it('never renders the full value', () => {
    const { container } = render(<MaskedContact kind="email" value="jane.doe@moe.go.ke" />);

    expect(container.textContent).not.toContain('jane.doe');
    expect(screen.getByText('j***@moe.go.ke')).toBeDefined();
  });

  it('never renders the full value when it contains a star', () => {
    const email = render(<MaskedContact kind="email" value="a*b@moe.go.ke" />);
    expect(email.container.textContent).not.toContain('a*b');
    email.unmount();

    const phone = render(<MaskedContact kind="phone" value="0712*345678" />);
    expect(phone.container.textContent).not.toContain('0712');
    expect(phone.container.textContent).toContain('07** *** 678');
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
