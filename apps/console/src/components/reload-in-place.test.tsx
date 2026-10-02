// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { useReloadingInPlace } from './reload-in-place';

const listSearch = z.object({ search: z.string().optional() });

/**
 * A list route set up as the console's lists are: search out of the loader deps, `shouldReload`,
 * the loader reading the search off the location. Each load waits until the test resolves it, and
 * the router shows the pending page at once rather than after a second.
 */
function renderList() {
  const loads: { search: string | undefined; resolve: () => void }[] = [];
  const history = createMemoryHistory({ initialEntries: ['/list'] });
  const root = createRootRoute({ component: Outlet });
  const list = createRoute({
    getParentRoute: () => root,
    path: '/list',
    validateSearch: listSearch,
    shouldReload: true,
    pendingMs: 0,
    loader: async ({ location }) => {
      const { search } = listSearch.parse(location.search);
      await new Promise<void>((resolve) => loads.push({ search, resolve }));
      return `results for ${search ?? 'everything'}`;
    },
    pendingComponent: () => <p>Loading page</p>,
    component: function List() {
      const results = list.useLoaderData();
      const reloading = useReloadingInPlace();
      return (
        <>
          <input
            aria-label="Search"
            onChange={(event) => {
              // The test router is not the app's registered one, so it is navigated by URL.
              history.push(`/list?search=${encodeURIComponent(event.target.value)}`);
            }}
          />
          <p>{reloading ? 'Loading results' : results}</p>
        </>
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([list]),
    history,
  });
  render(<RouterProvider router={router} />);
  return { loads };
}

describe('useReloadingInPlace', () => {
  it('keeps the page and its focused search box while a filter change loads', async () => {
    const { loads } = renderList();
    await waitFor(() => {
      expect(loads).toHaveLength(1);
    });
    act(() => {
      loads[0]?.resolve();
    });
    const box = await screen.findByRole('textbox', { name: 'Search' });
    expect(screen.getByText('results for everything')).toBeTruthy();
    box.focus();

    fireEvent.change(box, { target: { value: 'Pub' } });
    await waitFor(() => {
      expect(loads).toHaveLength(2);
    });

    expect(loads[1]?.search).toBe('Pub');
    expect(await screen.findByText('Loading results')).toBeTruthy();
    expect(screen.queryByText('Loading page')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Search' })).toBe(box);
    expect(document.activeElement).toBe(box);

    act(() => {
      loads[1]?.resolve();
    });
    expect(await screen.findByText('results for Pub')).toBeTruthy();
    expect(document.activeElement).toBe(box);
  });
});
