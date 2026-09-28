import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../components/roster/messages';

/** The import history and each import's report, under the Roster workspace's gate. */
export const Route = createFileRoute('/roster/imports')({
  staticData: { crumb: m.historyTitle },
  component: Outlet,
});
