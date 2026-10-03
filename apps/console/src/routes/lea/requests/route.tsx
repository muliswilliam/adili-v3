import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../components/lea/messages';

/** Whether a match's route context opens the law enforcement workspace. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'workspace' in context
    ? Boolean(context.workspace)
    : false;
}

/** The officer's requests, a new one, and each request under it. */
export const Route = createFileRoute('/lea/requests')({
  staticData: {
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? m.title : null),
  },
  component: Outlet,
});
