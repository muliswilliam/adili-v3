import { createFileRoute, redirect } from '@tanstack/react-router';

/** `/lea` (the spec's name for the workspace) opens the officer's requests. */
export const Route = createFileRoute('/lea/')({
  beforeLoad: () => {
    throw redirect({ to: '/lea/requests', replace: true });
  },
});
