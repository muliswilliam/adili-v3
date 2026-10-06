// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Breadcrumbs } from './breadcrumbs';

/** A route tree shaped like the console's: Home is a leaf, sections sit beside it. */
function renderAt(path: string) {
  const root = createRootRoute({
    component: () => (
      <>
        <Breadcrumbs />
        <Outlet />
      </>
    ),
  });
  const roster = createRoute({
    getParentRoute: () => root,
    path: '/roster',
    staticData: { crumb: 'Roster' },
  });
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/', staticData: { crumb: 'Home' } }),
    roster.addChildren([
      createRoute({ getParentRoute: () => roster, path: '/' }),
      createRoute({
        getParentRoute: () => roster,
        path: '/records',
        staticData: { crumb: 'Records' },
      }),
    ]),
    createRoute({
      getParentRoute: () => root,
      path: '/clarifications/$id',
      staticData: {
        crumb: () => ({ before: [{ label: 'Case', to: '/cases/1' }], label: 'Clarification' }),
      },
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/hidden',
      staticData: { crumb: () => null },
    }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(<RouterProvider router={router} />);
}

/** Each crumb's label and, for the linked ones, where it goes. */
async function trail() {
  const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
  return [...nav.querySelectorAll('li')].map((item) => {
    const link = item.querySelector('a');
    return link ? `${link.textContent} → ${link.getAttribute('href')}` : item.textContent;
  });
}

describe('Breadcrumbs', () => {
  it('starts a top-level page with a link back to Home (#743)', async () => {
    renderAt('/roster');
    expect(await trail()).toEqual(['Home → /', 'Roster']);
  });

  it('starts a nested page with Home', async () => {
    renderAt('/roster/records');
    expect(await trail()).toEqual(['Home → /', 'Roster → /roster', 'Records']);
  });

  it('shows Home once, unlinked, on Home itself', async () => {
    renderAt('/');
    expect(await trail()).toEqual(['Home']);
    expect(screen.getByText('Home').getAttribute('aria-current')).toBe('page');
  });

  it("puts Home before a crumb's links to pages the route tree does not nest it under", async () => {
    renderAt('/clarifications/7');
    expect(await trail()).toEqual(['Home → /', 'Case → /cases/1', 'Clarification']);
  });

  it('shows no trail when every crumb opts out', async () => {
    renderAt('/hidden');
    await screen.findByText((_, element) => element?.tagName === 'BODY');
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });
});
