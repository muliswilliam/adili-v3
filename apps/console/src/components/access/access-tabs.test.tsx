// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { AccessTabs } from './access-tabs';
import { queueSearchSchema } from './queue-query';

async function renderTabs(url: string) {
  const root = createRootRoute({ component: Outlet });
  const requests = createRoute({
    getParentRoute: () => root,
    path: '/access/requests',
    validateSearch: queueSearchSchema,
    component: function RequestTabs() {
      const search = queueSearchSchema.parse(
        useLocation({ select: (location) => location.search }),
      );
      return <AccessTabs current={search.kind ?? 'all'} />;
    },
  });
  const copies = createRoute({
    getParentRoute: () => root,
    path: '/access/certified-copies',
    component: () => <AccessTabs current="certified-copies" />,
  });
  const router = createRouter({
    routeTree: root.addChildren([requests, copies]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole('navigation', { name: 'Request types' });
}

describe('AccessTabs', () => {
  it.each([
    ['/access/requests', 'All'],
    ['/access/requests?kind=form-k', 'Form K'],
    ['/access/requests?kind=lea', 'Law enforcement'],
    ['/access/certified-copies', 'Certified copies'],
  ])('marks only the selected tab at %s', async (url, label) => {
    await renderTabs(url);
    const active = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toBe(label);
  });

  it('links the request types and marks the page on show', async () => {
    await renderTabs('/access/certified-copies');
    const nav = screen.getByRole('navigation', { name: 'Request types' });
    expect(nav).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('href')).toBe('/access/requests');
    const copies = screen.getByRole('link', { name: 'Certified copies' });
    expect(copies.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBeNull();
  });

  it('S11: opens the queue on law enforcement requests (#265)', async () => {
    await renderTabs('/access/requests?kind=lea');
    const lea = screen.getByRole('link', { name: 'Law enforcement' });
    expect(lea.getAttribute('href')).toBe('/access/requests?kind=lea');
    expect(lea.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Form K' }).getAttribute('href')).toBe(
      '/access/requests?kind=form-k',
    );
  });
});
