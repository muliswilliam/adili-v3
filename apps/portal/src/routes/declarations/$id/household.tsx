import { createFileRoute } from '@tanstack/react-router';

import { HouseholdSection } from '../../../components/declaration/household-section';
import { loadSectionFor, SectionUnavailable } from '../../../components/declaration/route-helpers';
import { sectionSearch, sectionSearchProps } from '../../../components/declaration/section-errors';
import type { SectionContentsByKind } from '../../../declaration/contents';

export const Route = createFileRoute('/declarations/$id/household')({
  validateSearch: sectionSearch,
  loader: async ({ params, location }) => {
    // Marital status (Your details) decides whether a spouse is expected.
    const [household, bio] = await Promise.all([
      loadSectionFor(params.id, 'household', location.href),
      loadSectionFor(params.id, 'bio', location.href),
    ]);
    if (household.status !== 'ok' || bio.status !== 'ok') return { status: 'unavailable' as const };
    return { ...household, officer: bio.section.contents as SectionContentsByKind['bio'] };
  },
  head: () => ({ meta: [{ title: 'Spouses and children · Adili Online' }] }),
  component: HouseholdRoute,
});

function HouseholdRoute() {
  const load = Route.useLoaderData();
  const search = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return (
    <HouseholdSection
      section={load.section}
      etag={load.etag}
      maritalStatus={load.officer.maritalStatus ?? null}
      officerSurname={load.officer.name?.surname}
      {...sectionSearchProps(search)}
    />
  );
}
