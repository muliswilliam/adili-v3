import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardIcon,
  CheckboxItem,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  formatDate,
  FormField,
  Icon,
  Input,
  Repeater,
  SegmentedChoice,
  useToast,
} from '@adili/ui';
import {
  Alert02Icon,
  Archive01Icon,
  Baby01Icon,
  FavouriteIcon,
  File01Icon,
  InformationCircleIcon,
  MinusSignCircleIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import type { LoadedSection } from '../../server/declarations.server';
import { BIO_MESSAGES } from '../../declaration/bio';
import type {
  Child,
  Draft,
  Household,
  MaritalStatus,
  OccupationSector,
  Spouse,
} from '../../declaration/contents';
import {
  childInclusion,
  type HouseholdIssue,
  householdIssues,
  isBlankPerson,
  type PersonField,
  personTitle,
  spouseState,
  statementsNeeded,
} from '../../declaration/household';
import {
  MARITAL_STATUS_LABELS,
  OCCUPATION_SECTOR_LABELS,
  optionsOf,
} from '../../declaration/labels';
import { relationship, stepLink } from './steps';
import { useShownErrors } from './section-errors';
import { useSectionAutosave, useWorkspace } from './workspace';

export const HOUSEHOLD_COPY = {
  spousesHint: 'Include a separated spouse.',
  noSpouse: 'No spouse to declare.',
  noSpouseText: (status: string) =>
    `You said you are ${status}. Change it in Your details if needed.`,
  spouseUnanswered: 'Add your spouse, or confirm you have none',
  noSpouseCheckbox: 'I have no spouse to declare',
  separatedToggle: 'We are separated',
  separatedHint:
    "You declare what you know of a separated spouse's finances. Say so in the statement if you do not know.",
  childrenHint: (date: string) => `Under 18 on ${date}`,
  childrenUnanswered: 'Add your dependent children, or confirm you have none under 18.',
  noChildrenCheckbox: 'I have no dependent children under 18',
  included: (date: string) => `Included: under 18 on ${date}`,
  notIncluded: (age: number) =>
    `Not included: ${String(age)} on the statement date. No statement is required.`,
  noDateOfBirth: 'Add a date of birth',
  removeTitle: (name: string) => `Remove ${name}?`,
  removeBody: 'Their financial statement will be kept until you discard the declaration.',
  removedToast: (name: string) => `${name} removed. Statement kept until you discard.`,
  removedHeading: 'Removed',
  archived: (name: string) => `${name}: statement kept until you discard.`,
} as const;

type Group = 'spouses' | 'children';

interface PendingRemoval {
  group: Group;
  id: string;
  title: string;
  /** Adult children have no statement to keep. */
  hasStatement: boolean;
}

export interface HouseholdSectionProps {
  section: LoadedSection;
  etag: string;
  /** From Your details; null until the declarant chooses one. */
  maritalStatus: MaritalStatus | null;
  /** Pre-fills a new child's surname. */
  officerSurname?: string;
  /** Show every missing answer at once, e.g. when arriving from the summary's list. */
  showErrors?: boolean;
}

/** Drops an optional field, so a cleared answer is absent rather than blank. */
function without<T extends object>(current: T, key: keyof T): T {
  return Object.fromEntries(Object.entries(current).filter(([name]) => name !== key)) as T;
}

function newId() {
  return crypto.randomUUID();
}

function dmy(iso: string) {
  const [year, month, day] = iso.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

function firstItemWithIssue(issues: HouseholdIssue[]) {
  return issues.find((found) => found.itemId)?.itemId ?? null;
}

/**
 * Spouses and children (paragraphs 6-7). Two repeaters whose cards open to edit a person; the
 * spouses card follows the marital status from Your details, and both ask for an explicit
 * "none" when empty. Each spouse and each child under 18 on the statement date gets a
 * financial statement: saving creates them, and removing a person (after a confirmation)
 * archives theirs, so the section navigation refreshes from the save.
 */
export function HouseholdSection({
  section,
  etag,
  maritalStatus,
  officerSurname,
  showErrors = false,
}: HouseholdSectionProps) {
  const { declaration, flush } = useWorkspace();
  const { toast } = useToast();
  const { value: household, update } = useSectionAutosave<Draft<Household>>(section, etag);
  const statementDate = formatDate(declaration.statementDate);
  const issues = householdIssues(household, maritalStatus);
  const [editing, setEditing] = useState<string | null>(() =>
    showErrors ? firstItemWithIssue(issues) : null,
  );
  const { touch: touchKey, shown } = useShownErrors(showErrors);
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const [badDates, setBadDates] = useState<ReadonlySet<string>>(new Set());
  const [removal, setRemoval] = useState<PendingRemoval | null>(null);

  const spouses = household.spouses?.items ?? [];
  const children = household.children?.items ?? [];
  const state = spouseState(maritalStatus, household);
  const status = maritalStatus ? MARITAL_STATUS_LABELS[maritalStatus].toLowerCase() : '';

  function openEditor(key: string | null) {
    if (editing && editing !== key) {
      const closed = editing;
      setVisited((current) => new Set([...current, closed]));
    }
    setEditing(key);
  }

  function touch(id: string, field: PersonField) {
    touchKey(`${id}:${field}`);
  }

  function itemIssues(id: string | undefined) {
    return id ? issues.filter((found) => found.itemId === id) : [];
  }

  function fieldError(id: string, field: PersonField): string | undefined {
    if ((field === 'separationDate' || field === 'dateOfBirth') && badDates.has(`${id}:${field}`)) {
      return BIO_MESSAGES.birthDateFormat;
    }
    const found = itemIssues(id).find((candidate) => candidate.field === field);
    if (!found) return undefined;
    return found.kind === 'invalid' || visited.has(id) || shown(`${id}:${field}`)
      ? found.message
      : undefined;
  }

  function setBadDate(key: string, invalid: boolean) {
    setBadDates((current) => {
      if (current.has(key) === invalid) return current;
      const next = new Set(current);
      if (invalid) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function editSpouse(id: string, patch: (spouse: Draft<Spouse>) => Draft<Spouse>) {
    update((current) => ({
      ...current,
      spouses: {
        ...current.spouses,
        items: (current.spouses?.items ?? []).map((spouse) =>
          spouse.id === id ? patch(spouse) : spouse,
        ),
      },
    }));
  }

  function editChild(id: string, patch: (child: Draft<Child>) => Draft<Child>) {
    update((current) => ({
      ...current,
      children: {
        ...current.children,
        items: (current.children?.items ?? []).map((child) =>
          child.id === id ? patch(child) : child,
        ),
      },
    }));
  }

  function addSpouse() {
    const id = newId();
    update((current) => ({
      ...current,
      spouses: {
        none: false,
        items: [...(current.spouses?.items ?? []), { id, separated: false }],
      },
    }));
    openEditor(id);
  }

  function addChild() {
    const id = newId();
    const name = officerSurname ? { surname: officerSurname } : undefined;
    update((current) => ({
      ...current,
      children: {
        none: false,
        items: [...(current.children?.items ?? []), { id, ...(name ? { name } : {}) }],
      },
    }));
    openEditor(id);
  }

  function remove(group: Group, id: string) {
    update((current) => ({
      ...current,
      [group]: {
        ...current[group],
        items: (current[group]?.items ?? []).filter((item) => item.id !== id),
      },
    }));
    if (editing === id) setEditing(null);
    // Archive the statement now so the section navigation catches up.
    flush('household');
  }

  function requestRemoval(group: Group, person: Draft<Spouse> | Draft<Child>, title: string) {
    if (!person.id) return;
    if (isBlankPerson(person)) {
      remove(group, person.id);
      toast({ title: 'Removed' });
      return;
    }
    const hasStatement =
      group === 'spouses' ||
      childInclusion((person as Draft<Child>).dateOfBirth, declaration.statementDate)?.included ===
        true;
    setRemoval({ group, id: person.id, title, hasStatement });
  }

  const yourDetails = (
    <Link {...stepLink(declaration.id, 'bio')} className="font-medium underline underline-offset-3">
      Your details
    </Link>
  );
  const archived = declaration.sections.filter(
    (candidate) => candidate.completeness === 'archived' && relationship(candidate.key) !== null,
  );
  const needed = statementsNeeded(household, declaration.statementDate);
  const conflictIssue = issues.find(
    (found) => found.code === 'spouse-conflicts-with-marital-status',
  );

  return (
    <div className="grid gap-6">
      <section aria-labelledby="spouses-heading">
        <Card>
          <CardHeader>
            <CardIcon>
              <Icon icon={FavouriteIcon} />
            </CardIcon>
            <h2 id="spouses-heading" className="text-base font-semibold">
              Spouses
            </h2>
            <CardDescription>{HOUSEHOLD_COPY.spousesHint}</CardDescription>
          </CardHeader>
          <div className="grid gap-4">
            {conflictIssue ? (
              <Alert variant="destructive" role="alert">
                <Icon icon={Alert02Icon} />
                <AlertDescription>{conflictIssue.message}</AlertDescription>
              </Alert>
            ) : null}

            {state === 'needs-status' ? (
              <Alert variant="neutral">
                <Icon icon={InformationCircleIcon} />
                <AlertDescription>
                  Choose your marital status in {yourDetails} first. Then add your spouse if you
                  have one.
                </AlertDescription>
              </Alert>
            ) : null}

            {state === 'not-expected' ? (
              <EmptyState
                className="rounded-xl bg-muted py-6"
                icon={<Icon icon={FavouriteIcon} />}
                title={HOUSEHOLD_COPY.noSpouse}
                text={
                  <>
                    You said you are {status}. Change it in {yourDetails} if needed.
                  </>
                }
              />
            ) : null}

            {state === 'unanswered' ? (
              <Alert variant="warning" role={showErrors ? 'alert' : 'note'}>
                <Icon icon={Alert02Icon} />
                <AlertTitle>{HOUSEHOLD_COPY.spouseUnanswered}</AlertTitle>
                <AlertDescription className="pt-2">
                  <NoneCheckbox
                    label={HOUSEHOLD_COPY.noSpouseCheckbox}
                    checked={false}
                    onChange={(none) => {
                      update((current) => ({ ...current, spouses: { none, items: [] } }));
                    }}
                  />
                </AlertDescription>
              </Alert>
            ) : null}

            {state === 'none' ? (
              <NoneCheckbox
                label={HOUSEHOLD_COPY.noSpouseCheckbox}
                checked
                onChange={(none) => {
                  update((current) => ({ ...current, spouses: { none, items: [] } }));
                }}
              />
            ) : null}

            {state === 'listed' || state === 'conflict' || state === 'unanswered' ? (
              <Repeater
                label="Spouses"
                items={spouses}
                getKey={(spouse) => spouse.id ?? ''}
                getTitle={(spouse, index) =>
                  personTitle(spouse.name, `Spouse ${String(index + 1)}`)
                }
                renderDescription={(spouse) => (
                  <PersonSummary
                    meta={spouseMeta(spouse)}
                    warning={editing === spouse.id ? undefined : itemIssues(spouse.id)[0]?.message}
                  />
                )}
                renderEditor={(spouse) => {
                  const id = spouse.id ?? '';
                  return (
                    <SpouseEditor
                      spouse={spouse}
                      error={(field) => fieldError(id, field)}
                      onTouch={(field) => {
                        touch(id, field);
                      }}
                      onBadDate={(invalid) => {
                        setBadDate(`${id}:separationDate`, invalid);
                      }}
                      onChange={(patch) => {
                        editSpouse(id, patch);
                      }}
                    />
                  );
                }}
                editingKey={editing}
                onEditingKeyChange={openEditor}
                onAdd={addSpouse}
                addLabel={spouses.length === 0 ? 'Add a spouse' : 'Add another spouse'}
                onRemove={(spouse, index) => {
                  requestRemoval(
                    'spouses',
                    spouse,
                    personTitle(spouse.name, `Spouse ${String(index + 1)}`),
                  );
                }}
                icon={FavouriteIcon}
              />
            ) : null}
          </div>
        </Card>
      </section>

      <section aria-labelledby="children-heading">
        <Card>
          <CardHeader>
            <CardIcon>
              <Icon icon={Baby01Icon} />
            </CardIcon>
            <h2 id="children-heading" className="text-base font-semibold">
              Dependent children
            </h2>
            <CardDescription>{HOUSEHOLD_COPY.childrenHint(statementDate)}</CardDescription>
          </CardHeader>
          <div className="grid gap-4">
            {children.length === 0 ? (
              showErrors && household.children?.none !== true ? (
                <Alert variant="warning" role="alert">
                  <Icon icon={Alert02Icon} />
                  <AlertTitle>{HOUSEHOLD_COPY.childrenUnanswered}</AlertTitle>
                  <AlertDescription className="pt-2">
                    <NoneCheckbox
                      label={HOUSEHOLD_COPY.noChildrenCheckbox}
                      checked={false}
                      onChange={(none) => {
                        update((current) => ({ ...current, children: { none, items: [] } }));
                      }}
                    />
                  </AlertDescription>
                </Alert>
              ) : (
                <NoneCheckbox
                  label={HOUSEHOLD_COPY.noChildrenCheckbox}
                  checked={household.children?.none === true}
                  onChange={(none) => {
                    update((current) => ({ ...current, children: { none, items: [] } }));
                  }}
                />
              )
            ) : null}

            {household.children?.none === true && children.length === 0 ? null : (
              <Repeater
                label="Dependent children"
                items={children}
                getKey={(child) => child.id ?? ''}
                getTitle={(child, index) => personTitle(child.name, `Child ${String(index + 1)}`)}
                renderDescription={(child) => (
                  <PersonSummary
                    meta={
                      child.dateOfBirth
                        ? `Born ${dmy(child.dateOfBirth)}`
                        : 'Date of birth not entered'
                    }
                    inclusion={
                      <Inclusion
                        dateOfBirth={child.dateOfBirth}
                        statementDate={declaration.statementDate}
                      />
                    }
                    warning={editing === child.id ? undefined : itemIssues(child.id)[0]?.message}
                  />
                )}
                renderEditor={(child) => {
                  const id = child.id ?? '';
                  return (
                    <ChildEditor
                      child={child}
                      maxYear={Number(declaration.statementDate.slice(0, 4))}
                      error={(field) => fieldError(id, field)}
                      onTouch={(field) => {
                        touch(id, field);
                      }}
                      onBadDate={(invalid) => {
                        setBadDate(`${id}:dateOfBirth`, invalid);
                      }}
                      onChange={(patch) => {
                        editChild(id, patch);
                      }}
                    />
                  );
                }}
                editingKey={editing}
                onEditingKeyChange={openEditor}
                onAdd={addChild}
                addLabel={children.length === 0 ? 'Add a child' : 'Add another child'}
                onRemove={(child, index) => {
                  requestRemoval(
                    'children',
                    child,
                    personTitle(child.name, `Child ${String(index + 1)}`),
                  );
                }}
                icon={Baby01Icon}
              />
            )}
          </div>
        </Card>
      </section>

      {archived.length > 0 ? (
        <section aria-labelledby="removed-heading">
          <Card>
            <h2 id="removed-heading" className="pb-3 text-base font-semibold">
              {HOUSEHOLD_COPY.removedHeading}
            </h2>
            <ul className="grid gap-2">
              {archived.map((removed) => (
                <li key={removed.key} className="flex items-center gap-2.5 text-sm">
                  <Icon icon={Archive01Icon} className="size-4 text-muted-foreground" />
                  {HOUSEHOLD_COPY.archived(removed.personName ?? 'Unnamed person')}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <Alert variant="neutral">
        <Icon icon={File01Icon} />
        <AlertDescription>
          <strong className="font-semibold">Statements needed:</strong> {needed.join(', ')}.
        </AlertDescription>
      </Alert>

      <Dialog
        open={removal !== null}
        onOpenChange={(open) => {
          if (!open) setRemoval(null);
        }}
      >
        {removal ? (
          <DialogContent {...(removal.hasStatement ? {} : { 'aria-describedby': undefined })}>
            <DialogHeader>
              <DialogTitle>{HOUSEHOLD_COPY.removeTitle(removal.title)}</DialogTitle>
              {removal.hasStatement ? (
                <DialogDescription>{HOUSEHOLD_COPY.removeBody}</DialogDescription>
              ) : null}
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRemoval(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  remove(removal.group, removal.id);
                  toast({
                    title: removal.hasStatement
                      ? HOUSEHOLD_COPY.removedToast(removal.title)
                      : `${removal.title} removed.`,
                  });
                  setRemoval(null);
                }}
              >
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function NoneCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <CheckboxItem
      label={label}
      checked={checked}
      onChange={(event) => {
        onChange(event.target.checked);
      }}
    />
  );
}

function spouseMeta(spouse: Draft<Spouse>): string {
  const parts = [spouse.nationalId?.trim() ? `ID ${spouse.nationalId.trim()}` : 'No ID given'];
  const sector = spouse.occupationSector;
  if (sector === 'public' || sector === 'private') {
    parts.push(`${OCCUPATION_SECTOR_LABELS[sector]} sector`);
  } else if (sector) {
    parts.push(OCCUPATION_SECTOR_LABELS[sector]);
  }
  if (spouse.separated) {
    parts.push(
      spouse.separationDate ? `Separated since ${formatDate(spouse.separationDate)}` : 'Separated',
    );
  }
  return parts.join(' · ');
}

function PersonSummary({
  meta,
  inclusion,
  warning,
}: {
  meta: string;
  inclusion?: ReactNode;
  warning?: string;
}) {
  return (
    <>
      <span className="block">{meta}</span>
      {inclusion}
      {warning ? (
        <span className="mt-0.5 flex items-center gap-1.5 text-warning-subtle-foreground">
          <Icon icon={Alert02Icon} className="size-3.5 shrink-0" />
          {warning}
        </span>
      ) : null}
    </>
  );
}

function Inclusion({
  dateOfBirth,
  statementDate,
}: {
  dateOfBirth: string | undefined;
  statementDate: string;
}) {
  const inclusion = childInclusion(dateOfBirth, statementDate);
  if (!inclusion) return <span className="block">{HOUSEHOLD_COPY.noDateOfBirth}</span>;
  if (inclusion.included) {
    return (
      <span className="mt-0.5 flex items-center gap-1.5 text-success-subtle-foreground">
        <Icon icon={Tick02Icon} className="size-3.5 shrink-0" />
        {HOUSEHOLD_COPY.included(formatDate(statementDate))}
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex items-center gap-1.5">
      <Icon icon={MinusSignCircleIcon} className="size-3.5 shrink-0" />
      {HOUSEHOLD_COPY.notIncluded(inclusion.age)}
    </span>
  );
}

interface EditorProps<T> {
  error: (field: PersonField) => string | undefined;
  onTouch: (field: PersonField) => void;
  onBadDate: (invalid: boolean) => void;
  onChange: (patch: (current: T) => T) => void;
}

function NameFields<T extends Draft<Spouse> | Draft<Child>>({
  person,
  error,
  onTouch,
  onChange,
}: { person: T } & Omit<EditorProps<T>, 'onBadDate'>) {
  const setName = (part: 'surname' | 'firstName' | 'otherNames', text: string) => {
    onChange((current) => ({ ...current, name: { ...current.name, [part]: text } }));
  };
  const nameError = error('name');
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Surname" error={nameError}>
          <Input
            maxLength={100}
            autoComplete="off"
            value={person.name?.surname ?? ''}
            onBlur={() => {
              onTouch('name');
            }}
            onChange={(event) => {
              setName('surname', event.target.value);
            }}
          />
        </FormField>
        <FormField label="First name" error={nameError}>
          <Input
            maxLength={100}
            autoComplete="off"
            value={person.name?.firstName ?? ''}
            onBlur={() => {
              onTouch('name');
            }}
            onChange={(event) => {
              setName('firstName', event.target.value);
            }}
          />
        </FormField>
      </div>
      <FormField label="Other names" hint="Optional">
        <Input
          maxLength={100}
          autoComplete="off"
          value={person.name?.otherNames ?? ''}
          onChange={(event) => {
            setName('otherNames', event.target.value);
          }}
        />
      </FormField>
    </>
  );
}

function NationalIdField({
  value,
  error,
  onTouch,
  onChange,
}: {
  value: string | undefined;
  error: string | undefined;
  onTouch: () => void;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <FormField label="National ID" hint="Optional" error={error}>
      <Input
        inputMode="numeric"
        maxLength={10}
        autoComplete="off"
        value={value ?? ''}
        onBlur={onTouch}
        onChange={(event) => {
          const text = event.target.value.trim();
          onChange(text === '' ? undefined : text);
        }}
      />
    </FormField>
  );
}

function SpouseEditor({
  spouse,
  error,
  onTouch,
  onBadDate,
  onChange,
}: { spouse: Draft<Spouse> } & EditorProps<Draft<Spouse>>) {
  return (
    <>
      <NameFields person={spouse} error={error} onTouch={onTouch} onChange={onChange} />
      <div className="grid gap-4 sm:grid-cols-2">
        <NationalIdField
          value={spouse.nationalId}
          error={error('nationalId')}
          onTouch={() => {
            onTouch('nationalId');
          }}
          onChange={(nationalId) => {
            onChange((current) => ({
              ...without(current, 'nationalId'),
              ...(nationalId ? { nationalId } : {}),
            }));
          }}
        />
        <FormField label="KRA PIN" hint="Optional" error={error('kraPin')}>
          <Input
            maxLength={11}
            autoComplete="off"
            placeholder="A000000000Z"
            value={spouse.kraPin ?? ''}
            onBlur={() => {
              onTouch('kraPin');
            }}
            onChange={(event) => {
              const kraPin = event.target.value.trim().toUpperCase();
              onChange((current) => ({
                ...without(current, 'kraPin'),
                ...(kraPin ? { kraPin } : {}),
              }));
            }}
          />
        </FormField>
      </div>
      <SegmentedChoice
        legend="Occupation sector"
        hint="Optional"
        options={optionsOf(OCCUPATION_SECTOR_LABELS)}
        value={spouse.occupationSector ?? null}
        onValueChange={(sector) => {
          onChange((current) => ({ ...current, occupationSector: sector as OccupationSector }));
        }}
      />
      <CheckboxItem
        label={HOUSEHOLD_COPY.separatedToggle}
        checked={spouse.separated === true}
        onChange={(event) => {
          const separated = event.target.checked;
          if (!separated) onBadDate(false);
          onChange((current) => ({
            ...without(current, 'separationDate'),
            separated,
            ...(separated && spouse.separationDate
              ? { separationDate: spouse.separationDate }
              : {}),
          }));
        }}
      />
      {spouse.separated ? (
        <div className="grid gap-3 rounded-lg bg-muted p-4 sm:ml-7">
          <FormField label="Date of separation" error={error('separationDate')}>
            <DateInput
              value={spouse.separationDate ?? null}
              onBlur={() => {
                onTouch('separationDate');
              }}
              onValueChange={(date, details) => {
                onBadDate(details.invalid);
                onChange((current) => ({
                  ...without(current, 'separationDate'),
                  ...(date ? { separationDate: date } : {}),
                }));
              }}
            />
          </FormField>
          <p className="flex gap-2 text-sm text-secondary-foreground">
            <Icon icon={InformationCircleIcon} className="mt-0.5 size-4 shrink-0" />
            {HOUSEHOLD_COPY.separatedHint}
          </p>
        </div>
      ) : null}
    </>
  );
}

function ChildEditor({
  child,
  maxYear,
  error,
  onTouch,
  onBadDate,
  onChange,
}: { child: Draft<Child>; maxYear: number } & EditorProps<Draft<Child>>) {
  return (
    <>
      <NameFields person={child} error={error} onTouch={onTouch} onChange={onChange} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Date of birth" error={error('dateOfBirth')}>
          <DateInput
            value={child.dateOfBirth ?? null}
            maxYear={maxYear}
            onBlur={() => {
              onTouch('dateOfBirth');
            }}
            onValueChange={(date, details) => {
              onBadDate(details.invalid);
              onChange((current) => ({
                ...without(current, 'dateOfBirth'),
                ...(date ? { dateOfBirth: date } : {}),
              }));
            }}
          />
        </FormField>
        <NationalIdField
          value={child.nationalId}
          error={error('nationalId')}
          onTouch={() => {
            onTouch('nationalId');
          }}
          onChange={(nationalId) => {
            onChange((current) => ({
              ...without(current, 'nationalId'),
              ...(nationalId ? { nationalId } : {}),
            }));
          }}
        />
      </div>
    </>
  );
}
