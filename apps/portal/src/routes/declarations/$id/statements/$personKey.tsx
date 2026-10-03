import { createFileRoute } from '@tanstack/react-router';

import type { Draft, PersonKey, PersonName } from '../../../../declaration/contents';
import { REGISTRY_COPY } from '../../../../declaration/copy';
import { fullName } from '../../../../declaration/format';
import { householdMember } from '../../../../declaration/household';
import { relationOfPerson } from '../../../../declaration/section-key';
import type { RegistryPerson } from '../../../../components/declaration/registries-panel';
import {
  loadSectionFor,
  requirePersonKey,
  SectionUnavailable,
  statementKey,
} from '../../../../components/declaration/route-helpers';
import {
  sectionSearch,
  sectionSearchProps,
} from '../../../../components/declaration/section-errors';
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
  personKey: PersonKey,
): Promise<HouseholdEntry | null> {
  if (relationOfPerson(personKey) === 'officer') return null;
  const result = await getDeclarationSection({
    data: { declarationId, sectionKey: 'household' },
  });
  if (result.status !== 'ok') return null;
  const member = householdMember(result.section.contents, personKey);
  if (!member) return null;
  if (member.relation === 'child') {
    return { separated: false, nationalId: member.person.nationalId };
  }
  const spouse = member.person;
  return {
    separated: spouse.separated === true,
    nationalId: spouse.nationalId,
    kraPin: spouse.kraPin,
  };
}

/** The person's registry suggestion sets; none when they cannot be read. */
async function suggestionSets(
  declarationId: string,
  personKey: PersonKey,
): Promise<LoadedSuggestionSet[]> {
  const result = await listDeclarationSuggestions({ data: { declarationId, personKey } });
  return result.status === 'ok' ? result.sets : [];
}

function registryPerson(
  personKey: PersonKey,
  name: Draft<PersonName> | undefined,
  entry: HouseholdEntry | null,
): RegistryPerson {
  const relation = relationOfPerson(personKey);
  const fallback =
    relation === 'spouse' ? REGISTRY_COPY.spouseFallback : REGISTRY_COPY.childFallback;
  const nationalId = entry?.nationalId?.trim();
  const first = name?.firstName?.trim() ?? '';
  return {
    name: fullName(name) || fallback,
    firstName: first === '' ? fallback : first,
    nationalId: nationalId ?? null,
    // The officer's ID is on record from onboarding, though the portal cannot see it.
    hasId: relation === 'officer' || Boolean(nationalId),
    kraPin: entry?.kraPin,
  };
}

export const Route = createFileRoute('/declarations/$id/statements/$personKey')({
  validateSearch: sectionSearch,
  loader: async ({ params, location }) => {
    const personKey = requirePersonKey(params.personKey);
    const load = await loadSectionFor(params.id, statementKey(personKey), location.href);
    if (load.status !== 'ok') return { load, personKey, entry: null, sets: [] };
    const [entry, sets] = await Promise.all([
      householdEntry(params.id, personKey),
      suggestionSets(params.id, personKey),
    ]);
    return { load, personKey, entry, sets };
  },
  head: () => ({ meta: [{ title: 'Financial statement · Adili Online' }] }),
  component: StatementRoute,
});

function StatementRoute() {
  const { load, personKey, entry, sets } = Route.useLoaderData();
  const search = Route.useSearch();
  if (load.status === 'unavailable') return <SectionUnavailable />;
  const name = load.section.contents.personName as Draft<PersonName> | undefined;
  return (
    // One screen per person: switching person starts from that statement's contents.
    <AttachmentUploadsProvider key={load.section.key}>
      <StatementSection
        section={load.section}
        etag={load.etag}
        separated={relationOfPerson(personKey) === 'spouse' && entry?.separated === true}
        {...sectionSearchProps(search)}
        renderAttachments={renderItemAttachments}
        registries={{ person: registryPerson(personKey, name, entry), sets }}
      />
    </AttachmentUploadsProvider>
  );
}
