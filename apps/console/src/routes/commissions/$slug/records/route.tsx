import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../../components/roster/messages';

/**
 * A Commission's roster records for platform admins (reads are audited). EACC staff see roster
 * counts only; the directory refuses them records, and the pages say so.
 */
export const Route = createFileRoute('/commissions/$slug/records')({
  staticData: { crumb: m.records },
  component: Outlet,
});
