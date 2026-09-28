import type { FormKV1 } from '@adili/forms';
import { type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { toggleInOrder } from '../lib/toggle-in-order';
import { useFieldIds } from '../lib/use-field-ids';
import { Checkbox, CheckboxItem } from './checkbox';
import { FieldError } from './form-field';

/**
 * What an access request asks for, or a decision grants: declaration years, whether the
 * officer's spouses and children are included, which sections, and clarifications (always false
 * for law-enforcement requests). The officer is always included. The `scope` of `form-k.v1`.
 */
export type Scope = FormKV1['scope'];

export type ScopeSection = Scope['sections'][number];

/** Every section of `form-k.v1`, labelled, in the order of the form. */
export const scopeSectionLabels: Record<ScopeSection, string> = {
  bio: 'Personal details',
  income: 'Income',
  assets: 'Assets',
  liabilities: 'Liabilities',
  other: 'Other information',
};

export const SCOPE_SECTIONS = Object.keys(scopeSectionLabels) as ScopeSection[];

type ScopeFlag = 'includeSpouses' | 'includeChildren' | 'includeClarifications';

/** True when `scope` asks for nothing beyond `requested`: a grant can only narrow a request. */
export function isScopeWithin(scope: Scope, requested: Scope): boolean {
  return (
    scope.years.every((year) => requested.years.includes(year)) &&
    scope.sections.every((section) => requested.sections.includes(section)) &&
    (!scope.includeSpouses || requested.includeSpouses) &&
    (!scope.includeChildren || requested.includeChildren) &&
    (!scope.includeClarifications || requested.includeClarifications)
  );
}

/** True when both scopes cover the same years, people, sections and clarifications. */
export function isSameScope(a: Scope, b: Scope): boolean {
  return isScopeWithin(a, b) && isScopeWithin(b, a);
}

function people(scope: Scope): string {
  if (scope.includeSpouses && scope.includeChildren) return 'Officer, spouses and children';
  if (scope.includeSpouses) return 'Officer and spouses';
  if (scope.includeChildren) return 'Officer and children';
  return 'Officer only';
}

/** `2025, 2026 · Officer and spouses · Income, assets · clarifications` */
export function formatScope(scope: Scope): string {
  const sections = SCOPE_SECTIONS.filter((section) => scope.sections.includes(section))
    .map((section, index) =>
      index === 0 ? scopeSectionLabels[section] : scopeSectionLabels[section].toLowerCase(),
    )
    .join(', ');
  return [
    [...scope.years].sort((a, b) => a - b).join(', '),
    people(scope),
    sections,
    ...(scope.includeClarifications ? ['clarifications'] : []),
  ].join(' · ');
}

export interface ScopePickerProps {
  value: Scope;
  onChange: (value: Scope) => void;
  /**
   * The declaration years on offer, e.g. the Commission's cycles so far. Years already chosen or
   * requested are shown too, so none is dropped unseen.
   */
  years: number[];
  /**
   * The requested scope, when choosing what to grant: anything outside it is disabled and
   * marked "Not requested", so a partial grant can only narrow the request.
   */
  restrictTo?: Scope;
  /**
   * Offer clarifications (Form K); law-enforcement requests do not cover them, so leave
   * `includeClarifications` false when this is off.
   */
  clarifications?: boolean;
  errors?: { years?: ReactNode; sections?: ReactNode };
  disabled?: boolean;
  /** Prefix for the checkboxes' `name`s, when several pickers share a form. */
  name?: string;
  className?: string;
}

/**
 * Chooses the scope of an access request or grant: years, people (the officer, spouses,
 * children, and clarifications) and sections, each a fieldset with a legend. Side by side from
 * 760px of its own width, stacked below.
 */
export function ScopePicker({
  value,
  onChange,
  years,
  restrictTo,
  clarifications = true,
  errors = {},
  disabled = false,
  name,
  className,
}: ScopePickerProps) {
  const officerId = useId();

  function item({
    field,
    option,
    label,
    checked,
    requested,
    onToggle,
  }: {
    field: keyof Scope;
    option?: string;
    label: string;
    checked: boolean;
    /** False when restricted and the request did not ask for it. */
    requested: boolean;
    onToggle: (on: boolean) => void;
  }) {
    return (
      <CheckboxItem
        key={option ?? field}
        name={name ? `${name}.${field}` : field}
        value={option}
        label={label}
        checked={checked}
        // A stray choice outside the request stays enabled so it can be unticked.
        disabled={disabled || (!requested && !checked)}
        hint={
          requested ? undefined : <span className="text-[11.5px] font-medium">Not requested</span>
        }
        onChange={(event) => {
          onToggle(event.currentTarget.checked);
        }}
      />
    );
  }

  const flag = (key: ScopeFlag, label: string) =>
    item({
      field: key,
      label,
      checked: value[key],
      requested: !restrictTo || restrictTo[key],
      onToggle: (on) => {
        onChange({ ...value, [key]: on });
      },
    });

  const sortedYears = [...new Set([...years, ...value.years, ...(restrictTo?.years ?? [])])].sort(
    (a, b) => a - b,
  );

  return (
    <div className={cn('@container', className)}>
      <div className="grid gap-3.5 @min-[760px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <ScopeGroup legend="Years" error={errors.years}>
          {sortedYears.map((year) =>
            item({
              field: 'years',
              option: String(year),
              label: String(year),
              checked: value.years.includes(year),
              requested: !restrictTo || restrictTo.years.includes(year),
              onToggle: (on) => {
                onChange({ ...value, years: toggleInOrder(value.years, year, on, sortedYears) });
              },
            }),
          )}
        </ScopeGroup>
        <ScopeGroup legend="People">
          {/* Always included: aria-disabled rather than disabled, so it stays at full strength
              (a native disabled checkbox greys out) while clicks leave it checked. */}
          <div className="flex gap-3">
            <Checkbox
              id={officerId}
              checked
              aria-disabled="true"
              onChange={() => undefined}
              className="mt-px cursor-default"
            />
            <label htmlFor={officerId} className="cursor-default text-sm leading-5 select-none">
              The officer
            </label>
          </div>
          {flag('includeSpouses', 'Spouses')}
          {flag('includeChildren', 'Children')}
          {clarifications ? (
            <div className="pt-0.5">{flag('includeClarifications', 'Clarifications')}</div>
          ) : null}
        </ScopeGroup>
        <ScopeGroup legend="Sections" error={errors.sections}>
          {SCOPE_SECTIONS.map((section) =>
            item({
              field: 'sections',
              option: section,
              label: scopeSectionLabels[section],
              checked: value.sections.includes(section),
              requested: !restrictTo || restrictTo.sections.includes(section),
              onToggle: (on) => {
                onChange({
                  ...value,
                  sections: toggleInOrder(value.sections, section, on, SCOPE_SECTIONS),
                });
              },
            }),
          )}
        </ScopeGroup>
      </div>
    </div>
  );
}

function ScopeGroup({
  legend,
  error,
  children,
}: {
  legend: string;
  error?: ReactNode;
  children: ReactNode;
}) {
  const ids = useFieldIds({ error });
  return (
    <fieldset
      aria-invalid={error ? true : undefined}
      aria-describedby={ids.describedBy}
      className={cn(
        'grid min-w-0 content-start gap-2.5 rounded-lg bg-card px-3.5 py-3',
        error ? 'shadow-control-error' : 'shadow-control',
      )}
    >
      {/* Floated so it lays out inside the padded box like any other row. */}
      <legend className="float-left mb-0.5 w-full text-[12.5px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        {legend}
      </legend>
      {children}
      {error ? <FieldError id={ids.errorId}>{error}</FieldError> : null}
    </fieldset>
  );
}
