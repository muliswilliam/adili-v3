import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../components/platform/messages';

/** Whether a match's route context opens Platform settings. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'workspace' in context
    ? Boolean(context.workspace)
    : false;
}

/** The agencies, and each agency's officers under it. */
export const Route = createFileRoute('/platform/law-enforcement')({
  staticData: {
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? m.title : null),
  },
  component: Outlet,
});
