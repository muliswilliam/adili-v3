import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { BioSection } from '../../../components/declaration/bio-section';
import { KraLine } from '../../../components/declaration/kra-line';
import { loadSectionFor, SectionUnavailable } from '../../../components/declaration/route-helpers';
import { listDeclarationSuggestions } from '../../../server/declarations';

/** The officer's KRA answer from their last registry check, for the line under Your details. */
async function kraSets(declarationId: string) {
  const result = await listDeclarationSuggestions({
    data: { declarationId, personKey: 'officer', sectionKey: 'bio' },
  });
  return result.status === 'ok' ? result.sets : [];
}

export const Route = createFileRoute('/declarations/$id/bio')({
  validateSearch: z.object({ errors: z.boolean().optional() }),
  loader: async ({ params, location }) => {
    const load = await loadSectionFor(params.id, 'bio', location.href);
    return { load, kra: load.status === 'ok' ? await kraSets(params.id) : [] };
  },
  head: () => ({ meta: [{ title: 'Your details · Adili Online' }] }),
  component: BioRoute,
});

function BioRoute() {
  const { load, kra } = Route.useLoaderData();
  const { errors } = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return (
    <div className="grid gap-5">
      <BioSection section={load.section} etag={load.etag} showErrors={errors === true} />
      <KraLine sets={kra} />
    </div>
  );
}
