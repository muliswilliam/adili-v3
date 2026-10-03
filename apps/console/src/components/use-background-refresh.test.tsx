// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
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

import { useBackgroundRefresh } from './use-background-refresh';

interface Counts {
  ok: boolean;
  label: string;
}

const isOk = (counts: Counts) => counts.ok;

/**
 * A counts page under a layout, as Roster > Coverage is: each load of the page waits until the
 * test answers it, with the next answer in `answers` (ok by default).
 */
function renderCounts() {
  const answers: boolean[] = [];
  const pending: (() => void)[] = [];
  const layoutLoads: number[] = [];
  let pageLoads = 0;
  const history = createMemoryHistory({ initialEntries: ['/counts'] });
  const root = createRootRoute({ component: Outlet });
  const layout = createRoute({
    getParentRoute: () => root,
    id: 'layout',
    // Kept while fresh, as a layout whose data the page does not refresh should be.
    staleTime: Infinity,
    loader: () => {
      layoutLoads.push(layoutLoads.length);
      return null;
    },
    component: Outlet,
  });
  const page = createRoute({
    getParentRoute: () => layout,
    path: '/counts',
    loader: async (): Promise<Counts> => {
      pageLoads += 1;
      const load = pageLoads;
      const ok = answers.shift() ?? true;
      if (load > 1) await new Promise<void>((resolve) => pending.push(resolve));
      return { ok, label: `load ${String(load)}${ok ? '' : ' failed'}` };
    },
    component: function Page() {
      // Typed by the app's registered router, which has no such route.
      const counts = page.useLoaderData() as unknown as Counts;
      const { refresh, refreshing } = useBackgroundRefresh({
        routeId: page.id,
        data: counts,
        succeeded: isOk,
        announcement: 'Counts updated',
      });
      return (
        <>
          <p>{refreshing ? 'Updating' : counts.label}</p>
          <button type="button" onClick={refresh}>
            Refresh
          </button>
        </>
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([layout.addChildren([page])]),
    history,
  });
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  /** Answers the load under way, once its loader is waiting. */
  const answer = async () => {
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    await act(async () => {
      pending.shift()?.();
      await Promise.resolve();
    });
  };
  return { answers, answer, layoutLoads, pageLoads: () => pageLoads };
}

describe('useBackgroundRefresh', () => {
  it('reads the page again on Refresh, not its layout, and says so once read', async () => {
    const view = renderCounts();
    await screen.findByText('load 1');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Updating');
    await view.answer();
    await screen.findByText('load 2');
    expect(await screen.findByText('Counts updated')).toBeTruthy();
    expect(view.layoutLoads).toEqual([0]);
  });

  it('does not say the counts were updated when reading them again failed', async () => {
    const view = renderCounts();
    await screen.findByText('load 1');
    view.answers.push(false);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await view.answer();
    await screen.findByText('load 2 failed');
    expect(screen.queryByText('Counts updated')).toBeNull();
  });

  it('reads the page again when the window regains focus, quietly', async () => {
    const view = renderCounts();
    await screen.findByText('load 1');
    act(() => {
      window.dispatchEvent(new FocusEvent('focus'));
    });
    await view.answer();
    await screen.findByText('load 2');
    expect(screen.queryByText('Counts updated')).toBeNull();
  });

  it('starts no second read while one is under way', async () => {
    const view = renderCounts();
    await screen.findByText('load 1');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Updating');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    act(() => {
      window.dispatchEvent(new FocusEvent('focus'));
    });
    await view.answer();
    await screen.findByText('load 2');
    expect(view.pageLoads()).toBe(2);
  });
});
