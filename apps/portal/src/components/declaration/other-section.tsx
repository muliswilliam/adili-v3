import {
  Button,
  Card,
  CountrySelect,
  FieldError,
  FieldHint,
  FormField,
  Icon,
  Input,
  Repeater,
  SegmentedChoice,
  Select,
  SelectItem,
  Textarea,
} from '@adili/ui';
import { RepeatIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import type { LoadedSection } from '../../server/declarations.server';
import type { CompletenessIssue } from '../../server/declarations/types';
import type {
  Draft,
  MaterialChangeEntry,
  MembershipKind,
  OtherInformation,
} from '../../declaration/contents';
import { blank } from '../../declaration/format';
import { MEMBERSHIP_KIND_LABELS, optionsOf } from '../../declaration/labels';
import {
  type DraftDirectorship,
  type DraftDualCitizenship,
  type DraftMembership,
  type DraftPendingCase,
  FREE_TEXT_LIMIT,
  freeTextCounter,
  materialChangeLine,
  materialChangeStep,
  NO_MATERIAL_CHANGES,
} from '../../declaration/other';
import { personLabel, stepLink } from './steps';
import { useFocusFirstError, useFocusLinkedField, useShownErrors } from './section-errors';
import { useSectionAutosave, useWorkspace } from './workspace';

type Other = Draft<OtherInformation>;
type Interests = NonNullable<Other['registrableInterests']>;
type ListName = 'directorships' | 'memberships' | 'pendingCases';

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

const BASE = '/registrableInterests';
const HOLDS = `${BASE}/dualCitizenship/holds`;
const COUNTRY = `${BASE}/dualCitizenship/country`;
const PENDING = `${BASE}/dualCitizenship/pendingApplication`;

/** An element id for a JSON pointer, e.g. `other-registrableInterests-directorships-0`. */
const idFor = (path: string) => `other${path.replaceAll('/', '-')}`;

const yesNo = (value: boolean | undefined) => (value === undefined ? null : value ? 'yes' : 'no');

const itemPath = (list: ListName, index: number) => `${BASE}/${list}/${String(index)}`;

interface OpenCard {
  list: ListName;
  index: number;
}

/** The interest card a JSON pointer is in, e.g. `/registrableInterests/memberships/0/kind`. */
function cardAt(path: string | undefined): OpenCard | null {
  const match = /^\/registrableInterests\/(directorships|memberships|pendingCases)\/(\d+)/.exec(
    path ?? '',
  );
  return match ? { list: match[1] as ListName, index: Number(match[2]) } : null;
}

function MaterialChanges({
  entries,
  declarationId,
}: {
  entries: Draft<MaterialChangeEntry>[];
  declarationId: string;
}) {
  const { declaration } = useWorkspace();
  const label = (personKey: string) => personLabel(declaration.sections, `statement:${personKey}`);

  return (
    <Card className="p-5">
      <section aria-labelledby="material-changes-heading" className="grid gap-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-[34px] place-items-center rounded-lg bg-brand-subtle text-brand-subtle-foreground"
          >
            <Icon icon={RepeatIcon} className="size-4" />
          </span>
          <div className="grid gap-0.5">
            <h2 id="material-changes-heading" className="text-base font-semibold">
              Material changes
            </h2>
            <p className="text-[13px] text-muted-foreground">From items marked as changed</p>
          </div>
        </div>
        {entries.length === 0 ? (
          <p className="rounded-lg bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
            {NO_MATERIAL_CHANGES}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry, index) => (
              <li
                key={`${entry.itemId ?? entry.kind ?? ''}-${String(index)}`}
                className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <p className="flex-1 text-sm">{materialChangeLine(entry, label)}</p>
                <Button asChild variant="ghost" size="sm">
                  <Link
                    {...stepLink(declarationId, materialChangeStep(entry))}
                    aria-label={`Edit ${materialChangeLine(entry, label)}`}
                  >
                    Edit
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}

function InterestGroup({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  const id = `other-${title.toLowerCase().replaceAll(' ', '-')}-heading`;
  return (
    <section
      aria-labelledby={id}
      className="grid gap-3 border-t border-border pt-5 first:border-0 first:pt-0"
    >
      <div className="grid gap-0.5">
        <h3 id={id} className="text-[15px] font-semibold">
          {title}
        </h3>
        {sub ? <p className="text-[13px] text-muted-foreground">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** One card list of interests (directorships, memberships or pending cases). */
function InterestList<T>({
  label,
  items,
  path,
  noun,
  addLabel,
  titleOf,
  describe,
  error,
  editing,
  onEditing,
  onAdd,
  onDuplicate,
  onRemove,
  renderFields,
}: {
  label: string;
  items: T[];
  path: (index: number) => string;
  /** "Directorship": the card's title until the item has a name. */
  noun: string;
  addLabel: string;
  titleOf: (item: T) => string | undefined;
  describe: (item: T) => string;
  error: (path: string) => string | undefined;
  editing: number | null;
  onEditing: (index: number | null) => void;
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  renderFields: (item: T, index: number) => ReactNode;
}) {
  // Interests carry no ids, so a card is known by its place in the list.
  const indexOf = new Map(items.map((item, index) => [item, index]));
  const at = (item: T) => indexOf.get(item) ?? -1;
  return (
    <Repeater
      label={label}
      items={items}
      getKey={(item) => String(at(item))}
      getTitle={(item, index) => {
        const title = titleOf(item)?.trim();
        if (title) return title;
        return `${noun} ${String(index + 1)}`;
      }}
      renderDescription={(item, index) => {
        const problem = editing === index ? undefined : error(path(index));
        return (
          <>
            {describe(item)}
            {problem ? <FieldError className="mt-1">{problem}</FieldError> : null}
          </>
        );
      }}
      renderEditor={(item, index) => (
        <div id={idFor(path(index))} className="grid gap-4 sm:grid-cols-2">
          {renderFields(item, index)}
          {error(path(index)) ? (
            <FieldError className="sm:col-span-2">{error(path(index))}</FieldError>
          ) : null}
        </div>
      )}
      editingKey={editing === null ? null : String(editing)}
      onEditingKeyChange={(key) => {
        onEditing(key === null ? null : Number(key));
      }}
      onAdd={onAdd}
      addLabel={addLabel}
      onDuplicate={(_, index) => {
        onDuplicate(index);
      }}
      onRemove={(_, index) => {
        onRemove(index);
      }}
      emptyText="None added."
      headingLevel={4}
    />
  );
}

export interface OtherSectionProps {
  section: LoadedSection;
  etag: string;
  /** Show every missing answer at once, e.g. when arriving from the summary's list. */
  showErrors?: boolean;
  /** A JSON pointer to focus, e.g. `/employment/nature` from an Ask Adili answer. */
  focusField?: string;
}

/**
 * Other information (paragraph 9): the material changes the service composes from flagged
 * items and the marital status change (read-only), the registrable interests and free text.
 * Autosaves the section without the composed changes. Missing answers come from the service's
 * issues and show once a card or field has been left, or all at once with `showErrors`.
 */
export function OtherSection({ section, etag, showErrors = false, focusField }: OtherSectionProps) {
  const { declaration } = useWorkspace();
  const [composed] = useState(() => (section.contents as Other).materialChanges ?? []);
  const [editable] = useState<LoadedSection>(() => {
    const contents = { ...section.contents };
    delete contents.materialChanges;
    return { ...section, contents };
  });
  const { value, update, issues } = useSectionAutosave<Other>(editable, etag);
  const { touch, shown } = useShownErrors(showErrors);
  // With every issue shown, the first card with one opens so its fields can be fixed.
  const [editing, setEditing] = useState<OpenCard | null>(() =>
    showErrors ? cardAt(issues[0]?.path) : null,
  );

  const interests: Interests = value.registrableInterests ?? {};
  const directorships = interests.directorships ?? [];
  const memberships = interests.memberships ?? [];
  const pendingCases = interests.pendingCases ?? [];
  const dual: DraftDualCitizenship = interests.dualCitizenship ?? {};
  const freeText = value.freeText ?? '';

  function issueAt(path: string): CompletenessIssue | undefined {
    return issues.find((candidate) => candidate.path === path);
  }

  function error(path: string) {
    const found = issueAt(path);
    return found && shown(path) ? found.message : undefined;
  }

  useFocusFirstError(showErrors, () => {
    const first = issues[0];
    return first ? idFor(first.path) : null;
  });
  // The pointer's element, or the nearest one it lies inside.
  useFocusLinkedField(focusField, () => {
    const parts = (focusField ?? '').split('/');
    for (let end = parts.length; end > 1; end -= 1) {
      const element = document.getElementById(idFor(parts.slice(0, end).join('/')));
      if (element) return element;
    }
    return null;
  });

  const setInterests = (patch: (current: Interests) => Interests) => {
    update((current) => ({
      ...current,
      registrableInterests: patch(current.registrableInterests ?? {}),
    }));
  };

  function setList<K extends ListName>(
    list: K,
    change: (items: NonNullable<Interests[K]>) => NonNullable<Interests[K]>,
  ) {
    setInterests((current) => ({
      ...current,
      [list]: change(current[list] ?? []),
    }));
  }

  function editItem<K extends ListName>(
    list: K,
    index: number,
    patch: Partial<NonNullable<Interests[K]>[number]>,
  ) {
    setList(
      list,
      (items) =>
        items.map((item, at) => (at === index ? { ...item, ...patch } : item)) as NonNullable<
          Interests[K]
        >,
    );
  }

  /** Opens a card (or closes every card); closing one shows its missing answers. */
  function openCard(next: OpenCard | null) {
    if (editing) touch(itemPath(editing.list, editing.index));
    setEditing(next);
  }

  function removeItem(list: ListName, index: number) {
    if (editing?.list === list) setEditing(null);
    setList(list, (items) => items.filter((_, at) => at !== index) as typeof items);
  }

  function addItem(list: ListName) {
    const index = (interests[list] ?? []).length;
    setList(list, (items) => [...items, {}] as typeof items);
    openCard({ list, index });
  }

  function duplicateItem(list: ListName, index: number) {
    setList(list, (items) => {
      const copy = { ...items[index] };
      return [...items.slice(0, index + 1), copy, ...items.slice(index + 1)] as typeof items;
    });
    openCard({ list, index: index + 1 });
  }

  /** The props every interest list shares, for the list named. */
  function listProps(list: ListName) {
    return {
      path: (index: number) => itemPath(list, index),
      error,
      editing: editing?.list === list ? editing.index : null,
      onEditing: (index: number | null) => {
        openCard(index === null ? null : { list, index });
      },
      onAdd: () => {
        addItem(list);
      },
      onDuplicate: (index: number) => {
        duplicateItem(list, index);
      },
      onRemove: (index: number) => {
        removeItem(list, index);
      },
    };
  }

  function setDual(patch: DraftDualCitizenship) {
    setInterests((current) => ({
      ...current,
      dualCitizenship: { ...current.dualCitizenship, ...patch },
    }));
  }

  const invalid = (path: string, missing: boolean) =>
    missing && error(path) !== undefined ? true : undefined;

  return (
    <div className="grid gap-6">
      <MaterialChanges entries={composed} declarationId={declaration.id} />

      <Card className="grid gap-5 p-5">
        <h2 className="text-base font-semibold">Registrable interests</h2>

        <InterestGroup title="Directorships">
          <InterestList<DraftDirectorship>
            {...listProps('directorships')}
            label="Directorships"
            items={directorships}
            noun="Directorship"
            addLabel="Add a directorship"
            titleOf={(entry) => entry.company}
            describe={(entry) =>
              [
                entry.role?.trim(),
                entry.remunerated === undefined ? undefined : entry.remunerated ? 'paid' : 'unpaid',
              ]
                .filter(Boolean)
                .join(' · ')
            }
            renderFields={(entry, index) => {
              const path = itemPath('directorships', index);
              return (
                <>
                  <FormField label="Company">
                    <Input
                      maxLength={200}
                      placeholder="e.g. Kapsoya Water Project Ltd"
                      value={entry.company ?? ''}
                      aria-invalid={invalid(path, blank(entry.company))}
                      onChange={(event) => {
                        editItem('directorships', index, { company: event.target.value });
                      }}
                    />
                  </FormField>
                  <FormField label="Role">
                    <Input
                      maxLength={100}
                      placeholder="e.g. Non-executive director"
                      value={entry.role ?? ''}
                      aria-invalid={invalid(path, blank(entry.role))}
                      onChange={(event) => {
                        editItem('directorships', index, { role: event.target.value });
                      }}
                    />
                  </FormField>
                  <SegmentedChoice
                    className="sm:col-span-2"
                    legend="Remunerated"
                    options={[
                      { value: 'yes', label: 'Yes, it is paid' },
                      { value: 'no', label: 'No' },
                    ]}
                    value={yesNo(entry.remunerated)}
                    onValueChange={(choice) => {
                      editItem('directorships', index, { remunerated: choice === 'yes' });
                    }}
                  />
                </>
              );
            }}
          />
        </InterestGroup>

        <InterestGroup
          title="Memberships"
          sub="Companies, partnerships, societies, clubs or trusts."
        >
          <InterestList<DraftMembership>
            {...listProps('memberships')}
            label="Memberships"
            items={memberships}
            noun="Membership"
            addLabel="Add a membership"
            titleOf={(entry) => entry.entity}
            describe={(entry) => (entry.kind ? MEMBERSHIP_KIND_LABELS[entry.kind] : '')}
            renderFields={(entry, index) => {
              const path = itemPath('memberships', index);
              return (
                <>
                  <FormField label="Entity">
                    <Input
                      maxLength={200}
                      placeholder="e.g. Kapsoya Parents Welfare Group"
                      value={entry.entity ?? ''}
                      aria-invalid={invalid(path, blank(entry.entity))}
                      onChange={(event) => {
                        editItem('memberships', index, { entity: event.target.value });
                      }}
                    />
                  </FormField>
                  <FormField label="Kind">
                    <Select
                      placeholder="Choose one"
                      value={entry.kind ?? ''}
                      aria-invalid={invalid(path, entry.kind === undefined)}
                      onValueChange={(kind) => {
                        editItem('memberships', index, { kind: kind as MembershipKind });
                      }}
                    >
                      {optionsOf(MEMBERSHIP_KIND_LABELS).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </Select>
                  </FormField>
                </>
              );
            }}
          />
        </InterestGroup>

        <InterestGroup title="Dual citizenship">
          <SegmentedChoice
            id={idFor(HOLDS)}
            legend="Do you hold citizenship of another country?"
            options={YES_NO}
            value={yesNo(dual.holds)}
            error={error(HOLDS)}
            onBlur={() => {
              touch(HOLDS);
            }}
            onValueChange={(choice) => {
              const holds = choice === 'yes';
              setInterests((current) => {
                const { country, ...rest } = current.dualCitizenship ?? {};
                return {
                  ...current,
                  dualCitizenship: holds ? { ...rest, country, holds } : { ...rest, holds },
                };
              });
            }}
          />
          {dual.holds ? (
            <div className="rounded-lg bg-muted p-4">
              <FormField label="Country" error={error(COUNTRY)} controlId={idFor(COUNTRY)}>
                <CountrySelect
                  exclude={['KE']}
                  value={dual.country ?? null}
                  onBlur={() => {
                    touch(COUNTRY);
                  }}
                  onValueChange={(code) => {
                    setDual({ country: code ?? undefined });
                  }}
                />
              </FormField>
            </div>
          ) : null}
          <SegmentedChoice
            id={idFor(PENDING)}
            legend="Do you have a pending application for citizenship of another country?"
            options={YES_NO}
            value={yesNo(dual.pendingApplication)}
            error={error(PENDING)}
            onBlur={() => {
              touch(PENDING);
            }}
            onValueChange={(choice) => {
              setDual({ pendingApplication: choice === 'yes' });
            }}
          />
        </InterestGroup>

        <InterestGroup title="Pending cases" sub="Unfinished cases before any court or body.">
          <InterestList<DraftPendingCase>
            {...listProps('pendingCases')}
            label="Pending cases"
            items={pendingCases}
            noun="Pending case"
            addLabel="Add a pending case"
            titleOf={(entry) => entry.reference}
            describe={(entry) => entry.forum?.trim() ?? ''}
            renderFields={(entry, index) => {
              const path = itemPath('pendingCases', index);
              return (
                <>
                  <FormField label="Court or body">
                    <Input
                      maxLength={200}
                      placeholder="e.g. Eldoret Chief Magistrate's Court"
                      value={entry.forum ?? ''}
                      aria-invalid={invalid(path, blank(entry.forum))}
                      onChange={(event) => {
                        editItem('pendingCases', index, { forum: event.target.value });
                      }}
                    />
                  </FormField>
                  <FormField label="Case reference">
                    <Input
                      maxLength={100}
                      placeholder="e.g. ELC 45 of 2025"
                      value={entry.reference ?? ''}
                      aria-invalid={invalid(path, blank(entry.reference))}
                      onChange={(event) => {
                        editItem('pendingCases', index, { reference: event.target.value });
                      }}
                    />
                  </FormField>
                  <FormField label="Nature" className="sm:col-span-2">
                    <Textarea
                      rows={2}
                      maxLength={500}
                      placeholder="e.g. Boundary dispute over the Kapsoya plot"
                      value={entry.nature ?? ''}
                      aria-invalid={invalid(path, blank(entry.nature))}
                      onChange={(event) => {
                        editItem('pendingCases', index, { nature: event.target.value });
                      }}
                    />
                  </FormField>
                </>
              );
            }}
          />
        </InterestGroup>
      </Card>

      <Card className="grid gap-1.5 p-5">
        <FormField
          label="Anything else that may be useful or relevant"
          hint="Optional."
          controlId="other-freeText"
        >
          <Textarea
            rows={6}
            maxLength={FREE_TEXT_LIMIT}
            placeholder="e.g. The Kapsabet farm is registered to my late father and is being transferred to me and my siblings."
            value={freeText}
            onChange={(event) => {
              const next = event.target.value;
              update((current) => ({ ...current, freeText: next }));
            }}
          />
        </FormField>
        <FieldHint aria-live="off" className="text-right tabular-nums">
          {freeTextCounter(freeText.length)}
        </FieldHint>
      </Card>
    </div>
  );
}
