// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AccessTabs } from './access-tabs';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string;
    search?: Record<string, string>;
    children: ReactNode;
  }) => (
    <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to} {...props}>
      {children}
    </a>
  ),
}));

describe('AccessTabs', () => {
  it('links the request types and marks the page on show', () => {
    render(<AccessTabs current="certified-copies" />);
    const nav = screen.getByRole('navigation', { name: 'Request types' });
    expect(nav).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('href')).toBe('/access/requests');
    const copies = screen.getByRole('link', { name: 'Certified copies' });
    expect(copies.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBeNull();
  });

  it('S11: opens the queue on law enforcement requests (#265)', () => {
    render(<AccessTabs current="lea" />);
    const lea = screen.getByRole('link', { name: 'Law enforcement' });
    expect(lea.getAttribute('href')).toBe('/access/requests?kind=lea');
    expect(lea.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Form K' }).getAttribute('href')).toBe(
      '/access/requests?kind=form-k',
    );
  });
});
