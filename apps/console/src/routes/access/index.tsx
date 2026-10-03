import { createFileRoute, redirect } from '@tanstack/react-router';

/** `/access` (the spec's name for the workspace) opens the queue. */
export const Route = createFileRoute('/access/')({
  beforeLoad: () => {
    throw redirect({ to: '/access/requests', replace: true });
  },
});
