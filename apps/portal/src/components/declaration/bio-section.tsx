import {
  Card,
  CheckboxItem,
  DateInput,
  FormField,
  Icon,
  Input,
  SegmentedChoice,
  Select,
  SelectItem,
  Textarea,
} from '@adili/ui';
import { Building03Icon, LockIcon } from '@hugeicons/core-free-icons';
import { useState } from 'react';

import { PERSON_FIELD_LABELS } from '../../declaration/field-labels';
import type { LoadedSection } from '../../server/declarations.server';
import {
  BIO_FIELD_ORDER,
  BIO_FIELD_PATHS,
  BIO_MESSAGES,
  type BioField,
  bioIssues,
} from '../../declaration/bio';
import {
  type Draft,
  type EmploymentNature,
  followsEarlierDeclaration,
  type MaritalStatus,
  type Officer,
} from '../../declaration/contents';
import {
  EMPLOYMENT_NATURE_LABELS,
  MARITAL_STATUS_LABELS,
  optionsOf,
} from '../../declaration/labels';
import { HR_LABELS, HR_PLACEHOLDERS, ROSTER_HINT } from '../../declaration/copy';
import { fullName } from '../../declaration/format';
import { isFromRoster, type RosterField, rosterPrefill } from '../../declaration/roster-prefill';
import { IprsBirthCheck } from './iprs-birth-check';
import { optionalLabel } from './optional-label';
import { useFocusFirstError, useFocusLinkedField, useShownErrors } from './section-errors';
import { useSectionAutosave, useWorkspace } from './workspace';

export const ROSTER_NOTE =
  "Wrong? Ask your Commission's reporting officer to correct the roster. Your name cannot be changed here.";

const fieldId = (field: BioField) => `bio-${field}`;

/** The field a pointer names, or the one it lies inside (`/birth/date` for `/birth`). */
function linkedBioField(pointer: string | undefined): BioField | null {
  if (!pointer) return null;
  const fields = Object.entries(BIO_FIELD_PATHS) as [BioField, string][];
  return (
    fields.find(([, path]) => path === pointer)?.[0] ??
    fields.find(([, path]) => path.startsWith(`${pointer}/`))?.[0] ??
    null
  );
}

/** Lines up the controls of side-by-side fields when only some of them show the roster hint. */
const ALIGNED_FIELD = 'sm:row-span-2 sm:grid-rows-subgrid';

function RosterBlock({ officer, commission }: { officer: Draft<Officer>; commission: string }) {
  const rows: [string, string | undefined][] = [
    ['Surname', officer.name?.surname],
    ['First name', officer.name?.firstName],
    ['Other names', officer.name?.otherNames],
    ['Reporting entity', officer.employment?.employer],
    ['Designation', officer.employment?.designation],
    ['Responsible Commission', commission],
  ];
  return (
    <section aria-labelledby="roster-heading" className="grid gap-3 rounded-lg bg-muted p-5">
      <div className="flex items-center gap-2">
        <Icon icon={LockIcon} className="size-4 text-muted-foreground" />
        <h2 id="roster-heading" className="text-base font-semibold">
          From your Commission's roster
        </h2>
      </div>
      <p className="text-sm text-secondary-foreground">{ROSTER_NOTE}</p>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
        {rows.map(([term, value]) => (
          <div key={term} className="grid gap-0.5">
            <dt className="text-[13px] text-muted-foreground">{term}</dt>
            <dd className="font-medium break-words">{value?.trim() ? value : '-'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RosterHint() {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon icon={Building03Icon} className="size-3.5" />
      {ROSTER_HINT}
    </span>
  );
}

export interface BioSectionProps {
  section: LoadedSection;
  etag: string;
  /** Show every missing answer at once, e.g. when arriving from the summary's list. */
  showErrors?: boolean;
  /** A JSON pointer to focus, e.g. `/employment/nature` from an Ask Adili answer. */
  focusField?: string;
}

/**
 * Your details (paragraphs 1-5): the locked roster block and the fields the declarant fills
 * in. Autosaves the whole `officer` object. Missing answers show once a field has been left
 * (or all at once with `showErrors`); a date that is not real shows while typing.
 */
export function BioSection({ section, etag, showErrors = false, focusField }: BioSectionProps) {
  const { declaration } = useWorkspace();
  const { value: officer, update } = useSectionAutosave<Draft<Officer>>(section, etag);
  const [appointmentInvalid, setAppointmentInvalid] = useState(false);
  const { touch, shown } = useShownErrors(showErrors);
  const [birthDateText, setBirthDateText] = useState<{ text: string; invalid: boolean }>({
    text: '',
    invalid: false,
  });

  const issues = bioIssues(officer, declaration.statementDate, declaration.type);
  if (birthDateText.invalid) {
    issues.birthDate = { kind: 'invalid', message: BIO_MESSAGES.dateFormat };
  }

  function error(field: BioField) {
    const issue = issues[field];
    if (!issue) return undefined;
    return issue.kind === 'invalid' || shown(field) ? issue.message : undefined;
  }

  useFocusFirstError(showErrors, () => {
    const first = BIO_FIELD_ORDER.find((field) => issues[field]);
    return first ? fieldId(first) : null;
  });
  useFocusLinkedField(focusField, () => {
    const field = linkedBioField(focusField);
    return field ? document.getElementById(fieldId(field)) : null;
  });

  // The roster's values as this page load read them; kept while the declarant edits (S8).
  const [roster] = useState(() =>
    rosterPrefill(section.contents, section.completeness === 'not-started'),
  );

  const rosterHint = (field: RosterField) =>
    isFromRoster(field, officer, roster) ? <RosterHint /> : undefined;

  const setEmployment = (patch: Partial<NonNullable<Draft<Officer>['employment']>>) => {
    update((current) => ({ ...current, employment: { ...current.employment, ...patch } }));
  };

  const set = (patch: (current: Draft<Officer>) => Draft<Officer>) => {
    update(patch);
  };

  const changed = officer.maritalStatusChange?.changed === true;
  const nature = officer.employment?.nature;

  return (
    <div className="grid gap-6">
      <RosterBlock officer={officer} commission={declaration.commission.name} />

      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        <IprsBirthCheck
          name={fullName(officer.name)}
          current={{ date: officer.birth?.date, place: officer.birth?.place }}
          onAccepted={(fresh) => {
            if (fresh.key !== 'bio') return;
            const birth = (fresh.contents as Draft<Officer>).birth;
            set((current) => ({ ...current, birth }));
          }}
        />
        <FormField
          label={PERSON_FIELD_LABELS.dateOfBirth}
          error={error('birthDate')}
          controlId={fieldId('birthDate')}
        >
          <DateInput
            value={officer.birth?.date ?? null}
            maxYear={Number(declaration.statementDate.slice(0, 4))}
            onBlur={() => {
              touch('birthDate');
            }}
            onValueChange={(date, details) => {
              setBirthDateText(details);
              set((current) => ({
                ...current,
                birth: { ...current.birth, date: date ?? undefined },
              }));
            }}
          />
        </FormField>
        <FormField
          label="Place of birth"
          error={error('birthPlace')}
          controlId={fieldId('birthPlace')}
        >
          <Input
            value={officer.birth?.place ?? ''}
            maxLength={100}
            placeholder="Town and county, e.g. Kapsabet, Nandi"
            onBlur={() => {
              touch('birthPlace');
            }}
            onChange={(event) => {
              const place = event.target.value;
              set((current) => ({ ...current, birth: { ...current.birth, place } }));
            }}
          />
        </FormField>

        <SegmentedChoice
          id={fieldId('maritalStatus')}
          className="sm:col-span-2"
          legend="Marital status"
          options={optionsOf(MARITAL_STATUS_LABELS)}
          value={officer.maritalStatus ?? null}
          hint={rosterHint('maritalStatus')}
          error={error('maritalStatus')}
          onBlur={() => {
            touch('maritalStatus');
          }}
          onValueChange={(status) => {
            set((current) => ({ ...current, maritalStatus: status as MaritalStatus }));
          }}
        />

        <FormField label="Postal address" error={error('postal')} controlId={fieldId('postal')}>
          <Textarea
            rows={3}
            maxLength={200}
            placeholder="P.O. Box 3100-30100, Eldoret"
            value={officer.address?.postal ?? ''}
            onBlur={() => {
              touch('postal');
            }}
            onChange={(event) => {
              const postal = event.target.value;
              set((current) => ({ ...current, address: { ...current.address, postal } }));
            }}
          />
        </FormField>
        <FormField
          label="Physical address"
          error={error('physical')}
          controlId={fieldId('physical')}
        >
          <Textarea
            rows={3}
            maxLength={200}
            placeholder="House, estate or road, town"
            value={officer.address?.physical ?? ''}
            onBlur={() => {
              touch('physical');
            }}
            onChange={(event) => {
              const physical = event.target.value;
              set((current) => ({ ...current, address: { ...current.address, physical } }));
            }}
          />
        </FormField>

        {/* An initial declaration is the first: there is no last one to have changed since. */}
        {followsEarlierDeclaration(declaration.type) ? (
          <div className="grid gap-3 sm:col-span-2">
            <CheckboxItem
              label="Marital status changed since last declaration"
              checked={changed}
              onChange={(event) => {
                const next = event.target.checked;
                set((current) => ({
                  ...current,
                  maritalStatusChange: next
                    ? { ...current.maritalStatusChange, changed: true }
                    : { changed: false },
                }));
              }}
            />
            {changed ? (
              <div className="ml-7 rounded-lg bg-muted p-4">
                <FormField
                  label="Explain the change"
                  error={error('maritalChange')}
                  controlId={fieldId('maritalChange')}
                >
                  <Textarea
                    rows={3}
                    maxLength={1000}
                    placeholder="e.g. Married Mary Wanjiru Kennedy in April 2025."
                    value={officer.maritalStatusChange?.explanation ?? ''}
                    onBlur={() => {
                      touch('maritalChange');
                    }}
                    onChange={(event) => {
                      const explanation = event.target.value;
                      set((current) => ({
                        ...current,
                        maritalStatusChange: { changed: true, explanation },
                      }));
                    }}
                  />
                </FormField>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        <h2 id="employment-heading" className="text-base font-semibold sm:col-span-2">
          Employment
        </h2>
        <FormField
          className={ALIGNED_FIELD}
          label={optionalLabel(HR_LABELS.jobGroup)}
          hint={rosterHint('jobGroup')}
          controlId="bio-jobGroup"
        >
          <Input
            maxLength={40}
            placeholder={HR_PLACEHOLDERS.jobGroup}
            value={officer.employment?.jobGroup ?? ''}
            onChange={(event) => {
              setEmployment({ jobGroup: event.target.value });
            }}
          />
        </FormField>
        <FormField
          className={ALIGNED_FIELD}
          label={optionalLabel(HR_LABELS.appointmentDate)}
          hint={rosterHint('appointmentDate')}
          error={appointmentInvalid ? BIO_MESSAGES.dateFormat : undefined}
          controlId="bio-appointmentDate"
        >
          <DateInput
            value={officer.employment?.appointmentDate ?? null}
            maxYear={Number(declaration.statementDate.slice(0, 4))}
            onValueChange={(date, details) => {
              setAppointmentInvalid(details.invalid);
              setEmployment({ appointmentDate: date ?? undefined });
            }}
          />
        </FormField>
        <FormField
          className={ALIGNED_FIELD}
          label={optionalLabel(HR_LABELS.workStation)}
          hint={rosterHint('workStation')}
          controlId="bio-workStation"
        >
          <Input
            maxLength={100}
            placeholder={HR_PLACEHOLDERS.workStation}
            value={officer.employment?.workStation ?? ''}
            onChange={(event) => {
              setEmployment({ workStation: event.target.value });
            }}
          />
        </FormField>
        <FormField
          className={ALIGNED_FIELD}
          label="Nature of employment"
          error={error('nature')}
          controlId={fieldId('nature')}
        >
          <Select
            placeholder="Choose one"
            value={nature ?? ''}
            onBlur={() => {
              touch('nature');
            }}
            onValueChange={(value) => {
              touch('nature');
              set((current) => ({
                ...current,
                employment: { ...current.employment, nature: value as EmploymentNature },
              }));
            }}
          >
            {optionsOf(EMPLOYMENT_NATURE_LABELS).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </Select>
        </FormField>
        {nature === 'other' ? (
          <FormField
            className={ALIGNED_FIELD}
            label="Describe it"
            error={error('natureOther')}
            controlId={fieldId('natureOther')}
          >
            <Input
              maxLength={100}
              placeholder="e.g. Secondment from a county"
              value={officer.employment?.natureOther ?? ''}
              onBlur={() => {
                touch('natureOther');
              }}
              onChange={(event) => {
                const natureOther = event.target.value;
                set((current) => ({
                  ...current,
                  employment: { ...current.employment, natureOther },
                }));
              }}
            />
          </FormField>
        ) : null}
      </Card>
    </div>
  );
}
