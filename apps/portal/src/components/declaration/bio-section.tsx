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
import { LockIcon } from '@hugeicons/core-free-icons';
import { useEffect, useState } from 'react';

import type { LoadedSection } from '../../server/declarations.server';
import { BIO_FIELD_ORDER, BIO_MESSAGES, type BioField, bioIssues } from './bio';
import type { Draft, EmploymentNature, MaritalStatus, Officer } from './contents';
import { EMPLOYMENT_NATURE_LABELS, MARITAL_STATUS_LABELS, optionsOf } from './labels';
import { useSectionAutosave, useWorkspace } from './workspace';

export const ROSTER_NOTE =
  "Wrong? Ask your Commission's reporting officer to correct the roster. Your name cannot be changed here.";

const fieldId = (field: BioField) => `bio-${field}`;

function focusField(field: BioField) {
  const element = document.getElementById(fieldId(field));
  const target = element instanceof HTMLFieldSetElement ? element.querySelector('input') : element;
  target?.focus();
}

function RosterBlock({ officer, commission }: { officer: Draft<Officer>; commission: string }) {
  const rows: [string, string | undefined][] = [
    ['Surname', officer.name?.surname],
    ['First name', officer.name?.firstName],
    ['Other names', officer.name?.otherNames],
    ['Employer', officer.employment?.employer],
    ['Designation', officer.employment?.designation],
    ['Responsible Commission', commission],
  ];
  return (
    <section aria-labelledby="roster-heading" className="grid gap-3 rounded-xl bg-muted p-5">
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

export interface BioSectionProps {
  section: LoadedSection;
  etag: string;
  /** Show every missing answer at once, e.g. when arriving from the summary's list. */
  showErrors?: boolean;
}

/**
 * Your details (paragraphs 1-5): the locked roster block and the fields the declarant fills
 * in. Autosaves the whole `officer` object. Missing answers show once a field has been left
 * (or all at once with `showErrors`); a date that is not real shows while typing.
 */
export function BioSection({ section, etag, showErrors = false }: BioSectionProps) {
  const { declaration } = useWorkspace();
  const { value: officer, update } = useSectionAutosave<Draft<Officer>>(section, etag);
  const [touched, setTouched] = useState<ReadonlySet<BioField>>(new Set());
  const [birthDateText, setBirthDateText] = useState<{ text: string; invalid: boolean }>({
    text: '',
    invalid: false,
  });

  const issues = bioIssues(officer, declaration.statementDate);
  if (birthDateText.invalid) {
    issues.birthDate = { kind: 'invalid', message: BIO_MESSAGES.birthDateFormat };
  }

  function error(field: BioField) {
    const issue = issues[field];
    if (!issue) return undefined;
    return issue.kind === 'invalid' || showErrors || touched.has(field) ? issue.message : undefined;
  }

  function touch(field: BioField) {
    setTouched((current) => (current.has(field) ? current : new Set([...current, field])));
  }

  useEffect(() => {
    if (!showErrors) return;
    const first = BIO_FIELD_ORDER.find((field) => issues[field]);
    if (first) focusField(first);
    // Only when arriving with errors shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showErrors]);

  const set = (patch: (current: Draft<Officer>) => Draft<Officer>) => {
    update(patch);
  };

  const changed = officer.maritalStatusChange?.changed === true;
  const nature = officer.employment?.nature;

  return (
    <div className="grid gap-6">
      <RosterBlock officer={officer} commission={declaration.commission.name} />

      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        <FormField
          label="Date of birth"
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

        <div className="grid gap-3 sm:col-span-2">
          <CheckboxItem
            label="My marital status changed since my last declaration"
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
      </Card>

      <Card className="grid gap-5 p-5 sm:grid-cols-2">
        <h2 id="employment-heading" className="text-base font-semibold sm:col-span-2">
          Employment
        </h2>
        <FormField
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
