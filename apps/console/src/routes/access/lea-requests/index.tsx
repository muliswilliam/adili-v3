import { createFileRoute, redirect } from '@tanstack/react-router';

/** The list of law enforcement requests is the queue's law enforcement tab. */
export const Route = createFileRoute('/access/lea-requests/')({
  beforeLoad: () => {
    throw redirect({ to: '/access/requests', search: { kind: 'lea' }, replace: true });
  },
});
