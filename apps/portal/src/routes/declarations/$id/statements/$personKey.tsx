import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import type { Draft, Household, PersonName } from '../../../../components/declaration/contents';
import { fullName } from '../../../../components/declaration/format';
import type { RegistryPerson } from '../../../../components/declaration/registries-panel';
import {
  loadSectionFor,
  SectionUnavailable,
  statementKey,
} from '../../../../components/declaration/route-helpers';
import {
  AttachmentUploadsProvider,
  renderItemAttachments,
} from '../../../../components/declaration/item-attachments';
import { StatementSection } from '../../../../components/declaration/statement-section';
import { getDeclarationSection, listDeclarationSuggestions } from '../../../../server/declarations';
import type { LoadedSuggestionSet } from '../../../../server/declarations.server';

interface HouseholdEntry {
  separated: boolean;
  nationalId?: string;
  kraPin?: string;
}

/**
 * What Household says about a spouse or child: whether a spouse is separated, and their national
 * ID and KRA PIN for Check registries. Null for the officer or when Household cannot be read.
 */
async function householdEntry(
  declarationId: string,
  personKey: string,
): Promise<HouseholdEntry | null> {
  if (personKey === 'officer') return null;
  const result = await getDeclarationSection({
    data: { declarationId, sectionKey: 'household' },
  });
  if (result.status !== 'ok') return null;
  const household = result.section.contents as Draft<Household>;
  const [kind, id] = personKey.split(':');
  if (kind === 'spouse') {
    const spouse = household.spouses?.items?.find((each) => each.id === id);
    return spouse
      ? {
          separated: spouse.separated === true,
          nationalId: spouse.nationalId,
          kraPin: spouse.kraPin,
        }
      : null;
  }
  const child = household.children?.items?.find((each) => each.id === id);
  return child ? { separated: false, nationalId: child.nationalId } : null;
}

/** The person's registry suggestion sets; none when they cannot be read. */
async function suggestionSets(
  declarationId: string,
  personKey: string,
): Promise<LoadedSuggestionSet[]> {
  const result = await listDeclarationSuggestions({ data: { declarationId, personKey } });
  return result.status === 'ok' ? result.sets : [];
}

function registryPerson(
  personKey: string,
  name: Draft<PersonName> | undefined,
  entry: HouseholdEntry | null,
): RegistryPerson {
  const fallback = personKey.startsWith('spouse:') ? 'your spouse' : 'this child';
  const nationalId = entry?.nationalId?.trim();
  const first = name?.firstName?.trim() ?? '';
  return {
    name: fullName(name) || fallback,
    firstName: first === '' ? fallback : first,
    nationalId: nationalId ?? null,
    // The officer's ID is on record from onboarding, though the portal cannot see it.
    hasId: personKey === 'officer' || Boolean(nationalId),
    kraPin: entry?.kraPin,
  };
}

export const Route = createFileRoute('/declarations/$id/statements/$personKey')({
  validateSearch: z.object({ errors: z.boolean().optional() }),
  loader: async ({ params, location }) => {
    const load = await loadSectionFor(params.id, statementKey(params.personKey), location.href);
    if (load.status !== 'ok') return { load, entry: null, sets: [] };
    const [entry, sets] = await Promise.all([
      householdEntry(params.id, params.personKey),
      suggestionSets(params.id, params.personKey),
    ]);
    return { load, entry, sets };
  },
  head: () => ({ meta: [{ title: 'Financial statement · Adili Online' }] }),
  component: StatementRoute,
});

function StatementRoute() {
  const { load, entry, sets } = Route.useLoaderData();
  const { personKey } = Route.useParams();
  const { errors } = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  const name = load.section.contents.personName as Draft<PersonName> | undefined;
  return (
    // One screen per person: switching person starts from that statement's contents.
    <AttachmentUploadsProvider key={load.section.key}>
      <StatementSection
        section={load.section}
        etag={load.etag}
        separated={personKey.startsWith('spouse:') && entry?.separated === true}
        showErrors={errors === true}
        renderAttachments={renderItemAttachments}
        registries={{ person: registryPerson(personKey, name, entry), sets }}
      />
    </AttachmentUploadsProvider>
  );
}
