import { createFileRoute } from '@tanstack/react-router';

import {
  requireDeclarationId,
  SectionUnavailable,
  settleLoad,
} from '../../../components/declaration/route-helpers';
import { SummaryView } from '../../../components/declaration/summary-view';
import { getDeclarationSummary } from '../../../server/declarations';

export const Route = createFileRoute('/declarations/$id/summary')({
  loader: async ({ params, location }) =>
    settleLoad(
      await getDeclarationSummary({ data: { declarationId: requireDeclarationId(params.id) } }),
      location.href,
    ),
  head: () => ({ meta: [{ title: 'Summary · Adili Online' }] }),
  component: SummaryRoute,
});

function SummaryRoute() {
  const load = Route.useLoaderData();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return <SummaryView summary={load.summary} />;
}
