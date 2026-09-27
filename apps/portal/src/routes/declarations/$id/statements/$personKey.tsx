import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import type { Draft, Household } from '../../../../components/declaration/contents';
import {
  loadSectionFor,
  SectionUnavailable,
  statementKey,
} from '../../../../components/declaration/route-helpers';
import { StatementSection } from '../../../../components/declaration/statement-section';
import { getDeclarationSection } from '../../../../server/declarations';

/** Whether the spouse a statement belongs to is separated (from the household section). */
async function spouseSeparated(declarationId: string, personKey: string): Promise<boolean> {
  if (!personKey.startsWith('spouse:')) return false;
  const result = await getDeclarationSection({
    data: { declarationId, sectionKey: 'household' },
  });
  if (result.status !== 'ok') return false;
  const household = result.section.contents as Draft<Household>;
  const spouseId = personKey.slice('spouse:'.length);
  return household.spouses?.items?.find((spouse) => spouse.id === spouseId)?.separated === true;
}

export const Route = createFileRoute('/declarations/$id/statements/$personKey')({
  validateSearch: z.object({ errors: z.boolean().optional() }),
  loader: async ({ params, location }) => {
    const load = await loadSectionFor(params.id, statementKey(params.personKey), location.href);
    const separated =
      load.status === 'ok' ? await spouseSeparated(params.id, params.personKey) : false;
    return { load, separated };
  },
  head: () => ({ meta: [{ title: 'Financial statement · Adili Online' }] }),
  component: StatementRoute,
});

function StatementRoute() {
  const { load, separated } = Route.useLoaderData();
  const { errors } = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  return (
    // One screen per person: switching person starts from that statement's contents.
    <StatementSection
      key={load.section.key}
      section={load.section}
      etag={load.etag}
      separated={separated}
      showErrors={errors === true}
    />
  );
}
