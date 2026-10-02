import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar } from './avatar';

describe('Avatar', () => {
  it('shows the initials, hidden from screen readers', () => {
    const { container } = render(<Avatar name="Peter Mwangi" />);

    const avatar = container.firstElementChild as HTMLElement;
    expect(avatar.textContent).toBe('PM');
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
    expect(avatar.className).toContain('bg-avatar');
  });

  it('takes the brand gradient for the signed-in user', () => {
    const { container } = render(<Avatar name="Faith Achieng" current />);

    const avatar = container.firstElementChild as HTMLElement;
    expect(avatar.dataset.current).toBe('true');
    expect(avatar.className).toContain('to-brand');
  });
});
