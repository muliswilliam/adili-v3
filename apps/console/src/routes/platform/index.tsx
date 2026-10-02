import { createFileRoute, redirect } from '@tanstack/react-router';

/** Platform settings open on law-enforcement accounts, its first page. */
export const Route = createFileRoute('/platform/')({
  beforeLoad: () => {
    throw redirect({ to: '/platform/law-enforcement', replace: true });
  },
});
