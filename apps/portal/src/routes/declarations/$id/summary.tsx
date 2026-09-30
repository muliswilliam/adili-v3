import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import {
  requireDeclarationId,
  SectionUnavailable,
  settleLoad,
} from '../../../components/declaration/route-helpers';
import type { SubmitFiling } from '../../../components/declaration/submit-flow';
import { SummaryView } from '../../../components/declaration/summary-view';
import { getDeclarationSummary } from '../../../server/declarations';
import { getObligationDetail } from '../../../server/obligations';

export const Route = createFileRoute('/declarations/$id/summary')({
  // The marker the BFF adds on the way back from a step-up (spec 06 FE-2).
  validateSearch: z.object({ stepUp: z.enum(['done', 'failed']).optional() }),
  loader: async ({ params, location }) => {
    const load = settleLoad(
      await getDeclarationSummary({ data: { declarationId: requireDeclarationId(params.id) } }),
      location.href,
    );
    if (load.status !== 'ok') return { ...load, filing: null };
    // For the late warning and the dates in conflict copy; the summary works without it.
    const obligation = await getObligationDetail({
      data: { id: load.summary.declaration.obligationId },
    }).catch(() => null);
    const filing: SubmitFiling | null =
      obligation?.status === 'ok'
        ? {
            dueDate: obligation.obligation.dueDate,
            overdue: obligation.obligation.status === 'overdue',
          }
        : null;
    return { ...load, filing };
  },
  head: () => ({ meta: [{ title: 'Summary · Adili Online' }] }),
  component: SummaryRoute,
});

function SummaryRoute() {
  const load = Route.useLoaderData();
  const { stepUp } = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return <SummaryView summary={load.summary} filing={load.filing} stepUpMarker={stepUp ?? null} />;
}
