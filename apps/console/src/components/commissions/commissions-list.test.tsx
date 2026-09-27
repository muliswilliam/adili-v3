// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  type CommissionFilters,
  type CommissionListSearch,
  searchForFilters,
} from '../../lib/commission-filters';
import { MOCK_COMMISSIONS } from '../../mocks/directory/fixtures';
import type { DirectoryFailure } from '../../server/directory/result';
import { CommissionsList, type CommissionsPageResult } from './commissions-list';
import { type PageLocation, pagingFor } from './paging';

interface Deferred {
  promise: Promise<CommissionsPageResult>;
  resolve: (result: CommissionsPageResult) => void;
}

function deferred(): Deferred {
  let resolve: Deferred['resolve'] = () => undefined;
  const promise = new Promise<CommissionsPageResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const ok = (count: number, nextCursor: string | null = null): CommissionsPageResult => ({
  ok: true,
  data: { items: MOCK_COMMISSIONS.slice(0, count), nextCursor },
});

/**
 * The list as the route drives it: search params hold the filters and cursor, and every change
 * starts a new load that the test settles.
 */
async function setup(initial: CommissionListSearch = {}) {
  const loads: { search: CommissionListSearch; load: Deferred }[] = [];
  const pageChanges: PageLocation[] = [];

  function start(search: CommissionListSearch) {
    const load = deferred();
    loads.push({ search, load });
    return load.promise;
  }

  function Harness() {
    const [state, setState] = useState(() => ({ search: initial, page: start(initial) }));
    return (
      <CommissionsList
        access="write"
        search={state.search}
        paging={pagingFor(state.search.cursor, undefined)}
        page={state.page}
        onFiltersChange={(filters: CommissionFilters) => {
          const search = searchForFilters(filters);
          setState({ search, page: start(search) });
        }}
        onPageChange={(location) => {
          pageChanges.push(location);
          setState({ search: location.search, page: start(location.search) });
        }}
        onRetry={vi.fn()}
        onSignedOut={vi.fn()}
      />
    );
  }

  const rootRoute = createRootRoute({ component: Harness });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/commissions'] }),
  });
  render(<RouterProvider router={router} />);
  // The router mounts its route components asynchronously.
  await screen.findByRole('searchbox', { name: 'Search Commissions' });

  return {
    loads,
    pageChanges,
    async settle(result: CommissionsPageResult) {
      const last = loads.at(-1);
      if (!last) throw new Error('nothing is loading');
      await act(async () => {
        last.load.resolve(result);
        await last.load.promise;
      });
    },
  };
}

const table = () => screen.getByRole('table', { hidden: true });
const bodyRows = () => within(table()).getAllByRole('row', { hidden: true }).slice(1);
const searchBox = () => screen.getByRole('searchbox', { name: 'Search Commissions' });
const typeFilter = () => screen.getByRole('combobox', { name: 'Type' });

describe('CommissionsList', () => {
  it('shows five skeleton rows with the toolbar enabled while the first page loads', async () => {
    await setup();
    expect(await screen.findByRole('table', { hidden: true })).toHaveProperty('ariaBusy', 'true');
    expect(bodyRows()).toHaveLength(5);
    expect(searchBox()).toHaveProperty('disabled', false);
    expect(typeFilter()).toHaveProperty('disabled', false);
  });

  it('swaps only the table for skeleton rows on a filter change, keeping focus in search', async () => {
    const list = await setupLoaded();
    const box = searchBox();
    box.focus();
    fireEvent.change(box, { target: { value: 'ken' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(list.loads.at(-1)?.search).toEqual({ search: 'ken' });
    expect(table()).toHaveProperty('ariaBusy', 'true');
    expect(bodyRows()).toHaveLength(5);
    expect(searchBox()).toBe(box);
    expect(document.activeElement).toBe(box);
    expect(box).toHaveProperty('disabled', false);

    await list.settle(ok(2));
    expect(bodyRows()).toHaveLength(2);
    expect(document.activeElement).toBe(box);
  });

  it('pages forward by cursor and drops the cursor when a filter changes', async () => {
    const list = await setupLoaded(ok(3, 'c2'));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(list.pageChanges.at(-1)?.search).toEqual({ cursor: 'c2' });
    await list.settle(ok(2));
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveProperty('disabled', false);

    fireEvent.change(typeFilter(), { target: { value: 'federated' } });
    expect(list.loads.at(-1)?.search).toEqual({
      search: undefined,
      type: 'federated',
      reportingOfficer: undefined,
    });
    await list.settle(ok(1));
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveProperty('disabled', true);
    expect(screen.getByText('1 Commission')).toBeTruthy();
  });

  it.each<[DirectoryFailure, string]>([
    [{ kind: 'unavailable', problem: null }, 'The directory service did not respond.'],
    [
      {
        kind: 'unavailable',
        problem: { type: 'about:blank', title: 'Down', status: 503, detail: 'Back at 10:00.' },
      },
      'Back at 10:00.',
    ],
    [{ kind: 'invalid', problem: null }, 'The directory service could not handle the request.'],
    [
      { kind: 'conflict', problem: null },
      'The directory service reported a conflict with the current data.',
    ],
  ])('explains a %j failure accurately', async (failure, text) => {
    const list = await setup();
    await list.settle({ ok: false, failure });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Commissions could not be loaded')).toBeTruthy();
    expect(within(alert).getByText(text)).toBeTruthy();
  });

  it('shows the forbidden state and disables the toolbar on a 403', async () => {
    const list = await setup();
    await list.settle({ ok: false, failure: { kind: 'forbidden', problem: null } });
    expect(screen.getByText('You do not have access to Commissions.')).toBeTruthy();
    expect(searchBox()).toHaveProperty('disabled', true);
  });

  it('shows the no-roster state for every Commission', async () => {
    await setupLoaded(ok(4));
    const rosterCells = bodyRows().map((row) => within(row).getAllByRole('cell').at(3));
    expect(rosterCells.map((cell) => cell?.textContent)).toEqual(Array(4).fill('No roster yet'));
  });
});

async function setupLoaded(result: CommissionsPageResult = ok(3)) {
  const list = await setup();
  await list.settle(result);
  expect(bodyRows().length).toBeGreaterThan(0);
  return list;
}
