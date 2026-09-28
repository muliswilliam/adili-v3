import { TableRowLink } from '@adili/ui';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { messages as m } from '../../../components/obligations/messages';
import { nationalSearchSchema } from '../../../components/obligations/national-summary';
import { NationalView } from '../../../components/obligations/national-view';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { workspaceFor } from '../../../components/workspaces';
import type {
  DeclarationsResult,
  NationalObligationsSummary,
} from '../../../server/declarations/client';
import { getNationalObligationsSummary } from '../../../server/obligations';
import { OpenOwnObligations } from './route';

export const Route = createFileRoute('/obligations_/national/')({
  // Order and page are applied in the browser: the summary is read once per visit.
  validateSearch: nationalSearchSchema,
  shouldReload: ({ cause }) => cause !== 'stay',
  loader: async ({ context, location }) => {
    // The layout shows why there is no workspace; do not fetch the summary.
    if (!context.workspace) return null;
    const summary = await getNationalObligationsSummary({ data: {} });
    if (!summary.ok && summary.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return summary;
  },
  head: () => ({ meta: [{ title: `${m.nationalTitle} · Adili Online Console` }] }),
  pendingComponent: NationalLoading,
  component: NationalLoaded,
});

function NationalLoading() {
  return <NationalPage result={null} />;
}

function NationalLoaded() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return <NationalPage result={result} />;
}

function NationalPage({
  result,
}: {
  result: DeclarationsResult<NationalObligationsSummary> | null;
}) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/obligations/national/' });
  const { roles } = Route.useRouteContext();
  return (
    <NationalView
      result={result}
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: next, resetScroll: false });
      }}
      commissionLink={(row) => (
        <TableRowLink asChild>
          <Link to="/commissions/$slug" params={{ slug: row.commission.slug }}>
            {row.commission.name}
          </Link>
        </TableRowLink>
      )}
      forbiddenAction={workspaceFor(roles, 'obligations') ? <OpenOwnObligations /> : undefined}
    />
  );
}
