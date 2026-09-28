import { createFileRoute, Outlet } from '@tanstack/react-router';

import { messages as m } from '../../../../components/obligations/messages';
import { signInRedirect } from '../../../../components/sign-in-redirect';
import { getCommissionObligationsSummary } from '../../../../server/obligations';

/**
 * A Commission's obligations for platform admins, reached from its page. EACC staff see its
 * counts on that page; the declarations service refuses them the officer list, and the page
 * says so.
 */
export const Route = createFileRoute('/commissions/$slug/obligations')({
  // The counts do not follow the list's filters: changing them does not read the summary again.
  shouldReload: ({ cause }) => cause !== 'stay',
  loader: async ({ params, location, context }) => {
    if (!context.workspace) return null;
    const summary = await getCommissionObligationsSummary({ data: { slug: params.slug } });
    if (!summary.ok && summary.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return summary;
  },
  staticData: { crumb: m.title },
  component: Outlet,
});
