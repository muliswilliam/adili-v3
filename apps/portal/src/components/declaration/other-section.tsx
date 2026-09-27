import {
  Button,
  Card,
  CountrySelect,
  FieldError,
  FieldHint,
  FormField,
  Icon,
  Input,
  SegmentedChoice,
  Select,
  SelectItem,
  Textarea,
} from '@adili/ui';
import { Add01Icon, Delete02Icon, RepeatIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';

import type { LoadedSection } from '../../server/declarations.server';
import type { CompletenessIssue } from '../../server/declarations/types';
import type { Draft, MaterialChangeEntry, MembershipKind, OtherInformation } from './contents';
import { MEMBERSHIP_KIND_LABELS, optionsOf } from './labels';
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
} from './other';
import { personLabel, stepLink } from './steps';
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
const blank = (value: string | undefined) => !value?.trim();

/** Focuses the field at a path, or in a card the first invalid field, else its first field. */
function focusPath(path: string) {
  const element = document.getElementById(idFor(path));
  if (!element) return;
  const target =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element
      : (element.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        element.querySelector<HTMLElement>('input, textarea, [role="combobox"]'));
  target?.focus();
}

function MaterialChanges({
  entries,
  declarationId,
}: {
  entries: Draft<MaterialChangeEntry>[];
  declarationId: string;
}) {
  const { declaration } = useWorkspace();
  const label = (personKey: string) =>
    personKey === 'officer' ? 'You' : personLabel(declaration.sections, `statement:${personKey}`);

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
          <p className="rounded-xl bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
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

function InterestCard({
  path,
  title,
  error,
  onRemove,
  children,
  onLeave,
}: {
  path: string;
  title: string;
  error?: string;
  onRemove: () => void;
  children: ReactNode;
  onLeave: () => void;
}) {
  return (
    <li
      id={idFor(path)}
      onBlur={onLeave}
      className="grid gap-4 rounded-item bg-card p-4 shadow-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[15px] font-medium">{title}</h4>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${title.toLowerCase()}`}
          onClick={onRemove}
        >
          <Icon icon={Delete02Icon} />
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
      {error ? <FieldError>{error}</FieldError> : null}
    </li>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full border border-dashed border-border"
      onClick={onClick}
    >
      <Icon icon={Add01Icon} />
      {label}
    </Button>
  );
}

function NoneAdded() {
  return <p className="text-sm text-muted-foreground">None added.</p>;
}

export interface OtherSectionProps {
  section: LoadedSection;
  etag: string;
  /** Show every missing answer at once, e.g. when arriving from the summary's list. */
  showErrors?: boolean;
}

/**
 * Other information (paragraph 9): the material changes the service composes from flagged
 * items and the marital status change (read-only), the registrable interests and free text.
 * Autosaves the section without the composed changes. Missing answers come from the service's
 * issues and show once a card or field has been left, or all at once with `showErrors`.
 */
export function OtherSection({ section, etag, showErrors = false }: OtherSectionProps) {
  const { declaration } = useWorkspace();
  const [composed] = useState(() => (section.contents as Other).materialChanges ?? []);
  const [editable] = useState<LoadedSection>(() => {
    const contents = { ...section.contents };
    delete contents.materialChanges;
    return { ...section, contents };
  });
  const { value, update, issues } = useSectionAutosave<Other>(editable, etag);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());

  const interests: Interests = value.registrableInterests ?? {};
  const directorships = interests.directorships ?? [];
  const memberships = interests.memberships ?? [];
  const pendingCases = interests.pendingCases ?? [];
  const dual: DraftDualCitizenship = interests.dualCitizenship ?? {};
  const freeText = value.freeText ?? '';

  function touch(path: string) {
    setTouched((current) => (current.has(path) ? current : new Set([...current, path])));
  }

  function issueAt(path: string): CompletenessIssue | undefined {
    return issues.find((candidate) => candidate.path === path);
  }

  function error(path: string) {
    const found = issueAt(path);
    return found && (showErrors || touched.has(path)) ? found.message : undefined;
  }

  useEffect(() => {
    if (!showErrors) return;
    const first = issues[0];
    if (first) focusPath(first.path);
    // Only when arriving with errors shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showErrors]);

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

  function removeItem(list: ListName, index: number) {
    setList(list, (items) => items.filter((_, at) => at !== index) as typeof items);
  }

  function addItem(list: ListName) {
    const index = (interests[list] ?? []).length;
    setList(list, (items) => [...items, {}] as typeof items);
    requestAnimationFrame(() => {
      focusPath(`${BASE}/${list}/${String(index)}`);
    });
  }

  function setDual(patch: DraftDualCitizenship) {
    setInterests((current) => ({
      ...current,
      dualCitizenship: { ...current.dualCitizenship, ...patch },
    }));
  }

  const itemPath = (list: ListName, index: number) => `${BASE}/${list}/${String(index)}`;
  const invalid = (path: string, missing: boolean) =>
    missing && error(path) !== undefined ? true : undefined;

  return (
    <div className="grid gap-6">
      <MaterialChanges entries={composed} declarationId={declaration.id} />

      <Card className="grid gap-5 p-5">
        <h2 className="text-base font-semibold">Registrable interests</h2>

        <InterestGroup title="Directorships">
          {directorships.length === 0 ? <NoneAdded /> : null}
          <ul className="grid gap-3" aria-label="Directorships">
            {directorships.map((entry: DraftDirectorship, index) => {
              const path = itemPath('directorships', index);
              const title = `Directorship ${String(index + 1)}`;
              return (
                <InterestCard
                  key={index}
                  path={path}
                  title={title}
                  error={error(path)}
                  onLeave={() => {
                    touch(path);
                  }}
                  onRemove={() => {
                    removeItem('directorships', index);
                  }}
                >
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
                </InterestCard>
              );
            })}
          </ul>
          <AddButton
            label="Add a directorship"
            onClick={() => {
              addItem('directorships');
            }}
          />
        </InterestGroup>

        <InterestGroup
          title="Memberships"
          sub="Companies, partnerships, societies, clubs or trusts."
        >
          {memberships.length === 0 ? <NoneAdded /> : null}
          <ul className="grid gap-3" aria-label="Memberships">
            {memberships.map((entry: DraftMembership, index) => {
              const path = itemPath('memberships', index);
              const title = `Membership ${String(index + 1)}`;
              return (
                <InterestCard
                  key={index}
                  path={path}
                  title={title}
                  error={error(path)}
                  onLeave={() => {
                    touch(path);
                  }}
                  onRemove={() => {
                    removeItem('memberships', index);
                  }}
                >
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
                </InterestCard>
              );
            })}
          </ul>
          <AddButton
            label="Add a membership"
            onClick={() => {
              addItem('memberships');
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
          {pendingCases.length === 0 ? <NoneAdded /> : null}
          <ul className="grid gap-3" aria-label="Pending cases">
            {pendingCases.map((entry: DraftPendingCase, index) => {
              const path = itemPath('pendingCases', index);
              const title = `Pending case ${String(index + 1)}`;
              return (
                <InterestCard
                  key={index}
                  path={path}
                  title={title}
                  error={error(path)}
                  onLeave={() => {
                    touch(path);
                  }}
                  onRemove={() => {
                    removeItem('pendingCases', index);
                  }}
                >
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
                </InterestCard>
              );
            })}
          </ul>
          <AddButton
            label="Add a pending case"
            onClick={() => {
              addItem('pendingCases');
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
