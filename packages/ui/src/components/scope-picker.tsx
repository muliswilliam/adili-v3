import type { FormKV1 } from '@adili/forms';
import { type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { toggleInOrder } from '../lib/toggle-in-order';
import { useFieldIds } from '../lib/use-field-ids';
import { Checkbox, CheckboxItem } from './checkbox';
import { FieldError } from './form-field';

/**
 * What an access request asks for, or a decision grants: declaration years, whether the
 * declarant's spouses and children are included, which sections, and whether the clarifications
 * the declarant gave on those declarations are included (Form K only: always false for a
 * law-enforcement request). The declarant is always included. The `scope` of `form-k.v1`.
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

/** `2025, 2026`: the years in order. */
export function formatScopeYears(scope: Pick<Scope, 'years'>): string {
  return [...scope.years].sort((a, b) => a - b).join(', ');
}

/** `Declarant and spouses`: who the scope covers, in the declarant's words. */
export function formatScopePeople(
  scope: Pick<Scope, 'includeSpouses' | 'includeChildren'>,
): string {
  if (scope.includeSpouses && scope.includeChildren) return 'Declarant, spouses and children';
  if (scope.includeSpouses) return 'Declarant and spouses';
  if (scope.includeChildren) return 'Declarant and children';
  return 'Declarant only';
}

/** `Income, assets`: the sections in the form's order, the first capitalised. */
export function formatScopeSections(scope: Pick<Scope, 'sections'>): string {
  return SCOPE_SECTIONS.filter((section) => scope.sections.includes(section))
    .map((section, index) =>
      index === 0 ? scopeSectionLabels[section] : scopeSectionLabels[section].toLowerCase(),
    )
    .join(', ');
}

/**
 * `2025, 2026 · Declarant and spouses · Income, assets, clarifications`. `people` words the
 * household for another reader (the console names the officer, the declarant's notices say
 * "You").
 */
export function formatScope(
  scope: Scope,
  people: (scope: Scope) => string = formatScopePeople,
): string {
  const contents = [
    formatScopeSections(scope),
    ...(scope.includeClarifications ? ['clarifications'] : []),
  ].join(', ');
  return [formatScopeYears(scope), people(scope), contents].join(' · ');
}

/** The name of the clarifications a scope can include, as the picker and the views show it. */
export const SCOPE_CLARIFICATIONS_LABEL = 'Clarifications';

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
   * Offer the declarant's clarifications (Form K, Act s.36(1)). Law-enforcement requests do not
   * cover them: leave this off and `includeClarifications` false.
   */
  clarifications?: boolean;
  errors?: { years?: ReactNode; sections?: ReactNode };
  disabled?: boolean;
  /** Prefix for the checkboxes' `name`s, when several pickers share a form. */
  name?: string;
  className?: string;
}

/**
 * Chooses the scope of an access request or grant: years, people (the declarant, spouses and
 * children) and sections, each a fieldset with a legend, side by side from 600px of its own
 * width and stacked below (the prototype shows three columns inside a card); with
 * `clarifications`, a fourth fieldset across them offers the declarant's clarifications.
 */
export function ScopePicker({
  value,
  onChange,
  years,
  restrictTo,
  clarifications = false,
  errors = {},
  disabled = false,
  name,
  className,
}: ScopePickerProps) {
  const declarantId = useId();

  function item({
    field,
    option,
    label,
    description,
    checked,
    requested,
    onToggle,
  }: {
    field: keyof Scope;
    option?: string;
    label: string;
    /** A line under the label saying what the option covers. */
    description?: string;
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
          requested ? (
            description
          ) : (
            <span className="text-[11.5px] font-medium">Not requested</span>
          )
        }
        onChange={(event) => {
          onToggle(event.currentTarget.checked);
        }}
      />
    );
  }

  const flag = (key: ScopeFlag, label: string, description?: string) =>
    item({
      field: key,
      label,
      description,
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
      <div className="grid gap-3.5 @min-[600px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
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
              id={declarantId}
              checked
              aria-disabled="true"
              onChange={() => undefined}
              className="mt-px cursor-default"
            />
            <label htmlFor={declarantId} className="cursor-default text-sm leading-5 select-none">
              The declarant
            </label>
          </div>
          {flag('includeSpouses', 'Spouses')}
          {flag('includeChildren', 'Children')}
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
        {clarifications ? (
          <ScopeGroup legend={SCOPE_CLARIFICATIONS_LABEL} className="@min-[600px]:col-span-3">
            {flag(
              'includeClarifications',
              "The declarant's clarifications",
              'Their answers to the Commission’s requests for clarification on these declarations',
            )}
          </ScopeGroup>
        ) : null}
      </div>
    </div>
  );
}

function ScopeGroup({
  legend,
  error,
  className,
  children,
}: {
  legend: string;
  error?: ReactNode;
  className?: string;
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
        className,
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
