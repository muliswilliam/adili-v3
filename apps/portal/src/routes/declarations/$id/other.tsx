import { createFileRoute } from '@tanstack/react-router';

import { OtherSection } from '../../../components/declaration/other-section';
import { loadSectionFor, SectionUnavailable } from '../../../components/declaration/route-helpers';
import { sectionSearch, sectionSearchProps } from '../../../components/declaration/section-errors';

export const Route = createFileRoute('/declarations/$id/other')({
  validateSearch: sectionSearch,
  loader: ({ params, location }) => loadSectionFor(params.id, 'other', location.href),
  head: () => ({ meta: [{ title: 'Other information · Adili Online' }] }),
  component: OtherRoute,
});

function OtherRoute() {
  const load = Route.useLoaderData();
  const search = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return <OtherSection section={load.section} etag={load.etag} {...sectionSearchProps(search)} />;
}
