// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccessShell } from './access-shell';

/** A real router, so the links' own active matching runs against the URL. */
function renderAt(url: string) {
  const rootRoute = createRootRoute();
  const page = (path: string, current?: 'requests' | 'new') =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <AccessShell current={current}>page</AccessShell>,
    });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      page('/access/requests', 'requests'),
      page('/access/requests/new', 'new'),
      page('/access/requests/$id'),
    ]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(<RouterProvider router={router} />);
}

async function currentLinks() {
  const nav = await screen.findByRole('navigation', { name: 'Access requests' });
  return within(nav)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.getAttribute('href'));
}

describe('AccessShell navigation', () => {
  it('marks only My requests on My requests', async () => {
    renderAt('/access/requests');
    expect(await currentLinks()).toEqual(['/access/requests']);
  });

  it('marks only New request on New request', async () => {
    renderAt('/access/requests/new');
    expect(await currentLinks()).toEqual(['/access/requests/new']);
  });

  it('marks My requests on a later page of My requests', async () => {
    renderAt('/access/requests?page=2');
    expect(await currentLinks()).toEqual(['/access/requests']);
  });

  it('marks neither on a request', async () => {
    renderAt('/access/requests/req-1');
    expect(await currentLinks()).toEqual([]);
  });
});
