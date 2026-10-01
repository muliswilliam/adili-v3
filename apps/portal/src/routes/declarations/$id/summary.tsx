import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import {
  requireDeclarationId,
  SectionUnavailable,
  settleLoad,
} from '../../../components/declaration/route-helpers';
import { SummaryView } from '../../../components/declaration/summary-view';
import { getDeclarationSummary } from '../../../server/declarations';

export const Route = createFileRoute('/declarations/$id/summary')({
  // The marker the BFF adds on the way back from a step-up (spec 06 FE-2).
  validateSearch: z.object({ stepUp: z.enum(['done', 'failed']).optional() }),
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
  const { stepUp } = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return <SummaryView summary={load.summary} stepUpMarker={stepUp ?? null} />;
}
