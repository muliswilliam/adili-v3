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

interface Loaded {
  results: string;
  loadedFor: string;
}

/**
 * A list route set up as the console's lists are: search out of the loader deps, `shouldReload`,
 * the loader reading the search off the location. Each load waits until the test resolves it, and
 * the router shows the pending page at once rather than after a second.
 */
function renderList() {
  const loads: { search: string | undefined; resolve: () => void }[] = [];
  const history = createMemoryHistory({ initialEntries: ['/list'] });
  const root = createRootRoute({ component: Outlet });
  // A layout loading once per visit, as the queue's counts do.
  const layoutLoads: number[] = [];
  const layout = createRoute({
    getParentRoute: () => root,
    id: 'layout',
    staleTime: Infinity,
    loader: () => {
      layoutLoads.push(layoutLoads.length);
      return null;
    },
    component: Outlet,
  });
  const list = createRoute({
    getParentRoute: () => layout,
    path: '/list',
    validateSearch: listSearch,
    shouldReload: true,
    pendingMs: 0,
    loader: async ({ location }): Promise<Loaded> => {
      const { search } = listSearch.parse(location.search);
      await new Promise<void>((resolve) => loads.push({ search, resolve }));
      return { results: `results for ${search ?? 'everything'}`, loadedFor: location.searchStr };
    },
    pendingComponent: () => <p>Loading page</p>,
    component: function List() {
      // Typed by the app's registered router, which has no such route.
      const loaded = list.useLoaderData() as unknown as Loaded;
      const reloading = useReloadingInPlace(loaded);
      return (
        <>
          <input
            aria-label="Search"
            onChange={(event) => {
              // The test router is not the app's registered one, so it is navigated by URL.
              history.push(`/list?search=${encodeURIComponent(event.target.value)}`);
            }}
          />
          <p>{reloading ? 'Loading results' : loaded.results}</p>
        </>
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([layout.addChildren([list])]),
    history,
  });
  render(<RouterProvider router={router} />);
  return { loads, layoutLoads };
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

  it('Q6: shows the latest search when a second change comes while the first loads', async () => {
    const { loads, layoutLoads } = renderList();
    await waitFor(() => {
      expect(loads).toHaveLength(1);
    });
    act(() => {
      loads[0]?.resolve();
    });
    const box = await screen.findByRole('textbox', { name: 'Search' });
    box.focus();

    fireEvent.change(box, { target: { value: 'Pu' } });
    await waitFor(() => {
      expect(loads).toHaveLength(2);
    });
    // A second change while the first loads: the router hands it the load under way.
    fireEvent.change(box, { target: { value: 'Pub' } });

    act(() => {
      loads[1]?.resolve();
    });

    // That answer was for "Pu": not shown, and the list loads again for "Pub".
    await waitFor(() => {
      expect(loads).toHaveLength(3);
    });
    expect(loads.map((load) => load.search)).toEqual([undefined, 'Pu', 'Pub']);
    expect(screen.queryByText('results for Pu')).toBeNull();
    expect(screen.getByText('Loading results')).toBeTruthy();
    act(() => {
      loads[2]?.resolve();
    });
    expect(await screen.findByText('results for Pub')).toBeTruthy();
    expect(document.activeElement).toBe(box);
    // Q14: loading again reloads the list alone, not the layout around it.
    expect(layoutLoads).toHaveLength(1);
  });
});
