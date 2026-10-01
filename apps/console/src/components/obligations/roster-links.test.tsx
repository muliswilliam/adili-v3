// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';

import { recordsSearchSchema, rosterRecordsQuery } from '../roster/records-query';
import { commissionNotOnboardedRosterLink, notOnboardedRosterLink } from './roster-links';

type RosterLink =
  ReturnType<typeof notOnboardedRosterLink> | ReturnType<typeof commissionNotOnboardedRosterLink>;

/** A router with just the two records lists (same search schema as the app's), showing `link`. */
async function renderLink(link: RosterLink) {
  // Typed against the app's registered router; this test router has the same paths.
  const props = link as unknown as ComponentProps<typeof Link>;
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Link {...props}>View roster</Link>,
  });
  const records = createRoute({
    getParentRoute: () => root,
    path: '/roster/records',
    validateSearch: recordsSearchSchema,
  });
  const commissionRecords = createRoute({
    getParentRoute: () => root,
    path: '/commissions/$slug/records',
    validateSearch: recordsSearchSchema,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, records, commissionRecords]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return screen.findByRole('link', { name: 'View roster' });
}

describe('S23 not-onboarded callout: View roster', () => {
  it("links the Commission's staff to their roster records, not onboarded only", async () => {
    const link = await renderLink(notOnboardedRosterLink());

    expect(link.getAttribute('href')).toBe('/roster/records?state=not_onboarded');
  });

  it("links a platform admin to the Commission's records, not onboarded only", async () => {
    const link = await renderLink(commissionNotOnboardedRosterLink('psc'));

    expect(link.getAttribute('href')).toBe('/commissions/psc/records?state=not_onboarded');
  });

  it('asks the directory for records not onboarded', () => {
    const { search } = notOnboardedRosterLink();

    expect(rosterRecordsQuery(recordsSearchSchema.parse(search))).toEqual({
      state: 'not_onboarded',
    });
  });
});
