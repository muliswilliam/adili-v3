import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { BioSection } from '../../../components/declaration/bio-section';
import { loadSectionFor, SectionUnavailable } from '../../../components/declaration/route-helpers';

export const Route = createFileRoute('/declarations/$id/bio')({
  validateSearch: z.object({ errors: z.boolean().optional() }),
  loader: ({ params, location }) => loadSectionFor(params.id, 'bio', location.href),
  head: () => ({ meta: [{ title: 'Your details · Adili Online' }] }),
  component: BioRoute,
});

function BioRoute() {
  const load = Route.useLoaderData();
  const { errors } = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return <BioSection section={load.section} etag={load.etag} showErrors={errors === true} />;
}
