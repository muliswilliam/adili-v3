import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../components/roster/messages';

/** The HR-system credential and its API documentation, under the Roster workspace's gate. */
export const Route = createFileRoute('/roster/api-access')({
  staticData: { crumb: m.apiTitle },
  component: Outlet,
});
