import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../components/access/messages';

/** Whether a match's route context opens the Access requests workspace. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'workspace' in context
    ? Boolean(context.workspace)
    : false;
}

/**
 * Law enforcement requests of the Commission (spec 10 FE-6), beside its Form K requests: the
 * trail leads back to the queue's law enforcement tab.
 */
export const Route = createFileRoute('/access/lea-requests')({
  staticData: {
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? m.title : null),
  },
  component: Outlet,
});
