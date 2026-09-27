import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { OtherSection } from '../../../components/declaration/other-section';
import { loadSectionFor, SectionUnavailable } from '../../../components/declaration/route-helpers';

export const Route = createFileRoute('/declarations/$id/other')({
  validateSearch: z.object({ errors: z.boolean().optional() }),
  loader: ({ params, location }) => loadSectionFor(params.id, 'other', location.href),
  head: () => ({ meta: [{ title: 'Other information · Adili Online' }] }),
  component: OtherRoute,
});

function OtherRoute() {
  const load = Route.useLoaderData();
  const { errors } = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return <OtherSection section={load.section} etag={load.etag} showErrors={errors === true} />;
}
