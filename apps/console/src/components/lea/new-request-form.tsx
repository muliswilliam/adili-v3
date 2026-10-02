import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  Combobox,
  daysBetween,
  formatDate,
  FormField,
  Icon,
  Input,
  ReferenceChip,
  ScopePicker,
  Spinner,
  StatusMark,
  Textarea,
  useIdempotencyKey,
} from '@adili/ui';
import {
  Alert02Icon,
  AlertCircleIcon,
  SentIcon,
  Tick02Icon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId, useRef, useState } from 'react';

import type { AccessResult } from '../../server/access-requests.server';
import type { AccessCommission, LeaRequest } from '../../server/access/types';
import { sendLeaRequest } from '../../server/lea-requests';
import { PageHead } from '../page';
import { goToSignIn } from '../sign-in-redirect';
import { messages as m } from './messages';
import {
  CASE_REFERENCE_MAX,
  emptyLeaDraft,
  hasLeaErrors,
  LEA_FIELDS,
  type LeaDraft,
  type LeaErrors,
  type LeaField,
  type LeaSubmitFailure,
  leaDraftErrors,
  leaInput,
  leaSubmitFailure,
  REASON_MAX,
} from './new-request';

/** The DOM id of a field's control, so the form can focus the first one at fault. */
const fieldId = (base: string, field: LeaField) => `${base}-${field}`;

/**
 * A new written request (spec 10 FE-6, S11, Regs r.23(1)): the Commission, the officer sought,
 * the reason and the case reference, and the scope. The declarant is told only after a grant.
 * Sent with one Idempotency-Key per body, so a retry after a network failure cannot file it
 * twice; then the LEA reference and the deadline the Commission's policy sets.
 */
export function NewRequestForm({ commissions }: { commissions: AccessCommission[] }) {
  const id = useId();
  const [draft, setDraft] = useState<LeaDraft>(emptyLeaDraft);
  const [errors, setErrors] = useState<LeaErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<LeaSubmitFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<LeaRequest | null>(null);
  const idempotencyKey = useIdempotencyKey();
  const alertRef = useRef<HTMLDivElement>(null);
  const chosen = commissions.find((each) => each.slug === draft.commission) ?? null;

  const change = (next: Partial<LeaDraft>) => {
    const updated = { ...draft, ...next };
    setDraft(updated);
    if (submitted) setErrors(leaDraftErrors(updated));
  };

  const focusFirst = (found: LeaErrors) => {
    const field = LEA_FIELDS.find((name) => found[name]);
    requestAnimationFrame(() => {
      if (!field) {
        alertRef.current?.focus();
        return;
      }
      const target = document.getElementById(fieldId(id, field));
      const focusable = target?.matches('input, textarea, button')
        ? target
        : target?.querySelector<HTMLElement>('input, textarea, button');
      focusable?.focus();
    });
  };

  const submit = async () => {
    setSubmitted(true);
    const found = leaDraftErrors(draft);
    setErrors(found);
    setFailure(null);
    if (hasLeaErrors(found) || !draft.commission) {
      focusFirst(found);
      return;
    }
    const input = leaInput({ ...draft, commission: draft.commission });
    setBusy(true);
    const result = await sendLeaRequest({
      data: { idempotencyKey: idempotencyKey.keyFor(input), input },
    }).catch((): AccessResult<LeaRequest> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
    setBusy(false);
    if (result.ok) {
      setSent(result.data);
      window.scrollTo({ top: 0 });
      return;
    }
    const failed = leaSubmitFailure(result.error);
    if (failed.signIn) {
      goToSignIn();
      return;
    }
    if (failed.newKey) idempotencyKey.reset();
    setFailure(failed);
    setErrors({ ...found, ...failed.fieldErrors });
    focusFirst(failed.fieldErrors);
  };

  if (sent) return <RequestSent request={sent} />;

  return (
    <>
      <PageHead title={m.newTitle} />
      <Card className="min-w-0 p-0 sm:p-0">
        <form
          noValidate
          aria-busy={busy || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
            <Section>
              <div ref={alertRef} tabIndex={-1} className="outline-none empty:hidden">
                {failure ? <SubmitAlert failure={failure} /> : null}
              </div>
              <FormField
                label={m.commission}
                error={errors.commission}
                controlId={fieldId(id, 'commission')}
              >
                <Combobox
                  options={commissions.map((commission) => ({
                    value: commission.slug,
                    label: commission.name,
                  }))}
                  value={draft.commission}
                  placeholder={m.commissionPlaceholder}
                  emptyText={m.commissionNone}
                  onValueChange={(slug) => {
                    const next = commissions.find((commission) => commission.slug === slug);
                    // Years the new Commission does not hold cannot be asked of it.
                    change({
                      commission: slug,
                      scope: {
                        ...draft.scope,
                        years: draft.scope.years.filter((year) => next?.years.includes(year)),
                      },
                    });
                  }}
                />
              </FormField>
              {chosen?.years.length === 0 ? (
                <Alert variant="warning">
                  <Icon icon={Alert02Icon} />
                  <AlertDescription>{m.noYears(chosen.name)}</AlertDescription>
                </Alert>
              ) : null}
            </Section>

            <Section title={m.officerSought}>
              <div className="grid gap-x-4 gap-y-[18px] min-[640px]:grid-cols-2">
                <FormField label={m.name} error={errors.name} controlId={fieldId(id, 'name')}>
                  <Input
                    value={draft.name}
                    placeholder={m.namePlaceholder}
                    autoComplete="off"
                    maxLength={220}
                    onChange={(event) => {
                      change({ name: event.target.value });
                    }}
                  />
                </FormField>
                <FormField
                  label={<Optional>{m.entity}</Optional>}
                  error={errors.entity}
                  controlId={fieldId(id, 'entity')}
                >
                  <Input
                    value={draft.entity}
                    placeholder={m.entityPlaceholder}
                    autoComplete="off"
                    maxLength={220}
                    onChange={(event) => {
                      change({ entity: event.target.value });
                    }}
                  />
                </FormField>
                <FormField
                  label={<Optional>{m.workStation}</Optional>}
                  error={errors.workStation}
                  controlId={fieldId(id, 'workStation')}
                >
                  <Input
                    value={draft.workStation}
                    autoComplete="off"
                    maxLength={220}
                    onChange={(event) => {
                      change({ workStation: event.target.value });
                    }}
                  />
                </FormField>
                <FormField
                  label={<Optional>{m.personnelFileNumber}</Optional>}
                  error={errors.personnelFileNumber}
                  controlId={fieldId(id, 'personnelFileNumber')}
                >
                  <Input
                    value={draft.personnelFileNumber}
                    autoComplete="off"
                    maxLength={40}
                    className="font-mono"
                    onChange={(event) => {
                      change({ personnelFileNumber: event.target.value });
                    }}
                  />
                </FormField>
              </div>
            </Section>

            <Section title={m.reasonAndCase}>
              <div className="grid gap-1">
                <FormField label={m.reason} error={errors.reason} controlId={fieldId(id, 'reason')}>
                  <Textarea
                    rows={5}
                    value={draft.reason}
                    placeholder={m.reasonPlaceholder}
                    onChange={(event) => {
                      change({ reason: event.target.value });
                    }}
                  />
                </FormField>
                <p
                  aria-live="polite"
                  className={
                    draft.reason.trim().length > REASON_MAX
                      ? 'text-right text-xs font-medium text-destructive tabular-nums'
                      : 'text-right text-xs text-muted-foreground tabular-nums'
                  }
                >
                  {m.count(draft.reason.trim().length, REASON_MAX)}
                </p>
              </div>
              <FormField
                label={m.caseReference}
                hint={m.caseReferenceHint}
                error={errors.caseReference}
                controlId={fieldId(id, 'caseReference')}
              >
                <Input
                  value={draft.caseReference}
                  placeholder={m.caseReferencePlaceholder}
                  autoComplete="off"
                  maxLength={CASE_REFERENCE_MAX + 20}
                  className="max-w-[360px] font-mono"
                  onChange={(event) => {
                    change({ caseReference: event.target.value });
                  }}
                />
              </FormField>
            </Section>

            <Section title={m.scope} hint={m.scopeHint}>
              <div id={fieldId(id, 'years')}>
                <ScopePicker
                  value={draft.scope}
                  onChange={(scope) => {
                    change({ scope });
                  }}
                  years={chosen?.years ?? []}
                  errors={{
                    // Years come with the Commission.
                    years: errors.years && !chosen ? m.commissionFirst : errors.years,
                    sections: errors.sections,
                  }}
                  name={`${id}-scope`}
                />
              </div>
              <span id={fieldId(id, 'sections')} hidden />
            </Section>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3 border-t px-5 py-4 sm:px-6">
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Icon icon={ViewOffSlashIcon} className="size-3.5" />
              {m.declarantToldAfter}
            </span>
            <div className="ml-auto flex gap-2">
              <Button asChild variant="secondary">
                <Link to="/lea/requests">{m.cancel}</Link>
              </Button>
              <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
                {busy ? <Spinner className="size-4" /> : <Icon icon={SentIcon} />}
                {busy ? m.sending : m.send}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-[18px] border-b px-5 py-5 sm:px-6" aria-label={title}>
      {title ? (
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {hint ? <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Optional({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">{m.optional}</span>
    </>
  );
}

function SubmitAlert({ failure }: { failure: LeaSubmitFailure }) {
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{failure.title}</AlertTitle>
      {failure.text || failure.unmapped.length > 0 ? (
        <AlertDescription>
          {failure.text ? <p>{failure.text}</p> : null}
          {failure.unmapped.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {failure.unmapped.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </AlertDescription>
      ) : null}
    </Alert>
  );
}

/** Sent: the LEA reference, and the days the Commission's policy gives it to decide. */
function RequestSent({ request }: { request: LeaRequest }) {
  return (
    <Card className="px-6 py-10 text-center">
      <div className="mx-auto grid max-w-[460px] justify-items-center gap-3" role="status">
        <StatusMark icon={Tick02Icon} tone="success" className="mb-2" />
        <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{m.sentTitle}</h2>
        <ReferenceChip reference={request.reference} size="lg" copyable />
        <p className="text-[14.5px] text-muted-foreground">
          {m.sentText(
            formatDate(request.receivedAt),
            request.commission.name,
            daysBetween(request.receivedAt, request.deadlineAt),
            formatDate(request.deadlineAt),
          )}
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link to="/lea/requests/$leaRequestId" params={{ leaRequestId: request.id }}>
              {m.viewRequest}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/lea/requests">{m.allRequests}</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
