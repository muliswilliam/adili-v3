import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../components/access/messages';

/** Whether a match's route context opens the Access requests workspace. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'workspace' in context
    ? Boolean(context.workspace)
    : false;
}

/** The queue and each request under it. */
export const Route = createFileRoute('/access/requests')({
  staticData: {
    // Staff without the workspace get no trail back to a page they cannot open.
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? m.title : null),
  },
  component: Outlet,
});
