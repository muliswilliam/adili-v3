import { Button, DateInput, FilterChip, FormField, Input } from '@adili/ui';
import { type SyntheticEvent, useState } from 'react';

import { AUDIT_KINDS, type AuditKind } from '../../server/audit/types';
import { messages as t } from './messages';

/** The filters in the URL (`/audit` search). */
export interface AuditFilterValues {
  kind?: AuditKind;
  tenant?: string;
  actor?: string;
  subjectPersonId?: string;
  action?: string;
  from?: string;
  to?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT = /^[a-z][a-z0-9]{1,19}$/;

const blank = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * The events list's filters: the kind as chips (applied at once), the rest as fields applied
 * together, so a half-typed id never searches. Clear empties everything.
 */
export function AuditFilters({
  applied,
  onApply,
}: {
  applied: AuditFilterValues;
  onApply: (filters: AuditFilterValues) => void;
}) {
  const [tenant, setTenant] = useState(applied.tenant ?? '');
  const [actor, setActor] = useState(applied.actor ?? '');
  const [person, setPerson] = useState(applied.subjectPersonId ?? '');
  const [action, setAction] = useState(applied.action ?? '');
  const [from, setFrom] = useState(applied.from ?? '');
  const [to, setTo] = useState(applied.to ?? '');
  const [touched, setTouched] = useState(false);

  const personError =
    person.trim() !== '' && !UUID.test(person.trim()) ? t.filters.invalidPerson : undefined;
  const tenantError =
    tenant.trim() !== '' && !TENANT.test(tenant.trim()) ? t.filters.invalidTenant : undefined;
  const hasFilters = Object.values(applied).some((value) => value !== undefined);

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (personError || tenantError) return;
    onApply({
      kind: applied.kind,
      tenant: blank(tenant),
      actor: blank(actor),
      subjectPersonId: blank(person)?.toLowerCase(),
      action: blank(action),
      from: blank(from),
      to: blank(to),
    });
  }

  function clear() {
    setTenant('');
    setActor('');
    setPerson('');
    setAction('');
    setFrom('');
    setTo('');
    setTouched(false);
    onApply({});
  }

  return (
    <form
      aria-label={t.filters.label}
      onSubmit={submit}
      className="border-b px-4 py-3.5"
      noValidate
    >
      <div role="group" aria-label={t.filters.kindLabel} className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip
          pressed={applied.kind === undefined}
          onPressedChange={() => {
            onApply({ ...applied, kind: undefined });
          }}
        >
          {t.filters.all}
        </FilterChip>
        {AUDIT_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            pressed={applied.kind === kind}
            onPressedChange={() => {
              onApply({ ...applied, kind });
            }}
          >
            {t.filters.kindChips[kind]}
          </FilterChip>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <FormField
          label={t.filters.tenant}

          error={touched ? tenantError : undefined}
        >
          <Input
            id="audit-tenant"
            placeholder={t.filters.tenantHint}
            value={tenant}
            maxLength={20}
            onChange={(e) => {
              setTenant(e.target.value);
            }}
          />
        </FormField>
        <FormField label={t.filters.actor}>
          <Input
            id="audit-actor"
            placeholder={t.filters.actorHint}
            value={actor}
            maxLength={200}
            onChange={(e) => {
              setActor(e.target.value);
            }}
          />
        </FormField>
        <FormField
          label={t.filters.person}

          error={touched ? personError : undefined}
        >
          <Input
            id="audit-person"
            placeholder={t.filters.personHint}
            value={person}
            maxLength={36}
            onChange={(e) => {
              setPerson(e.target.value);
            }}
          />
        </FormField>
        <FormField label={t.filters.action}>
          <Input
            id="audit-action"
            value={action}
            maxLength={200}
            placeholder={t.filters.actionHint}
            onChange={(e) => {
              setAction(e.target.value);
            }}
          />
        </FormField>
        <FormField label={t.filters.from}>
          <DateInput
            id="audit-from"
            value={from || null}
            onValueChange={(value) => {
              setFrom(value ?? '');
            }}
            minYear={2026}
          />
        </FormField>
        <FormField label={t.filters.to}>
          <DateInput
            id="audit-to"
            value={to || null}
            onValueChange={(value) => {
              setTo(value ?? '');
            }}
            minYear={2026}
          />
        </FormField>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          {t.filters.apply}
        </Button>
        {hasFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            {t.filters.clear}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
