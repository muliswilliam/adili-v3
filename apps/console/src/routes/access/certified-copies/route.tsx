import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../components/access/self-access/messages';

/** Whether a match's route context opens the Access requests workspace. */
function opensWorkspace(context: unknown): boolean {
  return typeof context === 'object' && context !== null && 'workspace' in context
    ? Boolean(context.workspace)
    : false;
}

/**
 * Written self-access applications for certified copies (spec 10 slice #302), a tab of the
 * Access requests workspace: the list, recording one, and each application.
 */
export const Route = createFileRoute('/access/certified-copies')({
  staticData: {
    // Staff without the workspace get no trail back to a page they cannot open.
    crumb: ({ context, isLeaf }) => (isLeaf || opensWorkspace(context) ? m.title : null),
  },
  component: Outlet,
});
