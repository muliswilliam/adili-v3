import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../components/roster/messages';

/** Roster records of the viewer's own Commission: the list and each record under it. */
export const Route = createFileRoute('/roster/records')({
  staticData: { crumb: m.records },
  component: Outlet,
});
