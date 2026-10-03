import { createFileRoute, redirect } from '@tanstack/react-router';

/** The workspace opens the national report until EACC's intake (#230) takes this page. */
export const Route = createFileRoute('/eacc/reports/')({
  beforeLoad: () => {
    throw redirect({ to: '/eacc/reports/ncr', replace: true });
  },
});
