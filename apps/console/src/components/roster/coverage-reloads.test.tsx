// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { coverageRouteSearch } from './declaration-progress';

/** A coverage route as the console's: its loader records the cycle each load counts. */
function renderCoverage() {
  const loads: (string | undefined)[] = [];
  const history = createMemoryHistory({ initialEntries: ['/coverage'] });
  const root = createRootRoute({ component: Outlet });
  const coverage = createRoute({
    getParentRoute: () => root,
    path: '/coverage',
    ...coverageRouteSearch,
    loader: ({ deps }) => {
      loads.push(deps.cycle);
      return `counts for ${deps.cycle ?? 'the current cycle'} (load ${String(loads.length)})`;
    },
    component: function Coverage() {
      // Typed by the app's registered router, which has no such route.
      return <p>{coverage.useLoaderData()}</p>;
    },
  });
  const router = createRouter({ routeTree: root.addChildren([coverage]), history });
  render(<RouterProvider router={router} />);
  const go = async (search: string) => {
    await act(async () => {
      history.push(`/coverage${search}`);
      await router.load();
    });
  };
  return { loads, go };
}

describe('coverage reloads', () => {
  it('counts a cycle again when it is chosen again, not from the earlier visit', async () => {
    const { loads, go } = renderCoverage();
    await screen.findByText('counts for the current cycle (load 1)');
    await go('?cycle=biennial%3A2025');
    await go('');
    await screen.findByText('counts for the current cycle (load 3)');
    expect(loads).toEqual([undefined, 'biennial:2025', undefined]);
  });

  it('keeps the counts in hand when only the search or the page changes', async () => {
    const { loads, go } = renderCoverage();
    await screen.findByText('counts for the current cycle (load 1)');
    await go('?search=health');
    await go('?search=health&page=2');
    expect(loads).toEqual([undefined]);
  });
});
