import { createFileRoute, notFound } from '@tanstack/react-router';

import {
  requireDeclarationId,
  SectionUnavailable,
  signInRedirect,
} from '../../../components/declaration/route-helpers';
import { SummaryView } from '../../../components/declaration/summary-view';
import { getDeclarationSummary } from '../../../server/declarations';

export const Route = createFileRoute('/declarations/$id/summary')({
  loader: async ({ params, location }) => {
    const result = await getDeclarationSummary({
      data: { declarationId: requireDeclarationId(params.id) },
    });
    if (result.status === 'unauthenticated') throw signInRedirect(location.href);
    if (result.status === 'not-found') throw notFound();
    return result;
  },
  head: () => ({ meta: [{ title: 'Summary · Adili Online' }] }),
  component: SummaryRoute,
});

function SummaryRoute() {
  const load = Route.useLoaderData();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return <SummaryView summary={load.summary} />;
}
