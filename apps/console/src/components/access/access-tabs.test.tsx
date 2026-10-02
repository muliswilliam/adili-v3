// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AccessTabs } from './access-tabs';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe('AccessTabs', () => {
  it('links the request types and marks the page on show', () => {
    render(<AccessTabs current="certified-copies" />);
    const nav = screen.getByRole('navigation', { name: 'Request types' });
    expect(nav).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Requests' }).getAttribute('href')).toBe(
      '/access/requests',
    );
    const copies = screen.getByRole('link', { name: 'Certified copies' });
    expect(copies.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Requests' }).getAttribute('aria-current')).toBeNull();
  });
});
