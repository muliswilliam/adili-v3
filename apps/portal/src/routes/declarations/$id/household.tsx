import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import type { Draft, Officer } from '../../../declaration/contents';
import { HouseholdSection } from '../../../components/declaration/household-section';
import { loadSectionFor, SectionUnavailable } from '../../../components/declaration/route-helpers';
import { getDeclarationSection } from '../../../server/declarations';

export const Route = createFileRoute('/declarations/$id/household')({
  validateSearch: z.object({ errors: z.boolean().optional() }),
  loader: async ({ params, location }) => {
    // Marital status (Your details) decides whether a spouse is expected.
    const [household, bio] = await Promise.all([
      loadSectionFor(params.id, 'household', location.href),
      getDeclarationSection({ data: { declarationId: params.id, sectionKey: 'bio' } }),
    ]);
    if (household.status !== 'ok' || bio.status !== 'ok') return { status: 'unavailable' as const };
    return { ...household, officer: bio.section.contents as Draft<Officer> };
  },
  head: () => ({ meta: [{ title: 'Spouses and children · Adili Online' }] }),
  component: HouseholdRoute,
});

function HouseholdRoute() {
  const load = Route.useLoaderData();
  const { errors } = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return (
    <HouseholdSection
      section={load.section}
      etag={load.etag}
      maritalStatus={load.officer.maritalStatus ?? null}
      officerSurname={load.officer.name?.surname}
      showErrors={errors === true}
    />
  );
}
