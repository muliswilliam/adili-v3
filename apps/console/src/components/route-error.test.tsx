// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouteError, RouteNotFound } from './route-error';

/** A router set up as the app's is (router.tsx), with one page that fails until told not to. */
function renderApp(path: string, page: { fails: boolean }) {
  const root = createRootRoute({ component: Outlet });
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/', component: () => <p>Home page</p> }),
    createRoute({
      getParentRoute: () => root,
      path: '/broken',
      component: () => {
        if (page.fails) throw new Error('Evaluating a string as JavaScript violates the CSP');
        return <p>Recovered page</p>;
      },
    }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
  });
  return render(<RouterProvider router={router} />);
}

describe('RouteError', () => {
  it('shows a styled error page with a way home instead of the bare default, and retries', async () => {
    const page = { fails: true };
    renderApp('/broken', page);

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
    expect(screen.queryByText('Something went wrong!')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to the start' }).getAttribute('href')).toBe('/');

    page.fails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Recovered page')).toBeTruthy();
  });
});

describe('RouteNotFound', () => {
  it('shows a styled not-found page for a path no route matches', async () => {
    renderApp('/nowhere', { fails: false });

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the start' }).getAttribute('href')).toBe('/');
  });
});
