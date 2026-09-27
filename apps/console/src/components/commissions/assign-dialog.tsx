import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DialogClose,
  DialogContent,
  type DialogContentProps,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
} from '@adili/ui';
import {
  ArrowRightLeft,
  Check,
  CircleAlert,
  LoaderCircle,
  Mail,
  Send,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import { type SyntheticEvent, useId, useRef, useState } from 'react';

import { assignReportingOfficer } from '../../server/commissions';
import type { Commission } from '../../server/directory/client';
import {
  ASSIGN_FIELDS,
  type AssignAlert,
  type AssignDraft,
  type AssignField,
  type AssignFieldErrors,
  assignFailure,
  checkAssignDraft,
  checkAssignField,
  EMPTY_ASSIGN_DRAFT,
} from './assign-form';
import { messages as m } from './messages';
import { formatPhone, normalisePhone } from './phone';

interface DialogState {
  draft: AssignDraft;
  errors: AssignFieldErrors;
  /** Set after the first submit: fields are then re-checked as they change. */
  submitted: boolean;
  unmapped: string[];
  alert: AssignAlert | null;
  submitting: boolean;
}

export interface AssignDialogProps {
  commission: Pick<Commission, 'slug' | 'name' | 'reportingOfficer'>;
  /**
   * `replace` when the Commission has an officer: the dialog warns that they lose access. The
   * request is the same either way; the directory replaces a current officer.
   */
  mode?: 'assign' | 'replace';
  /** Called with the updated Commission once the invitation is sent. */
  onAssigned: (commission: Commission) => void;
  /** Where focus goes when the dialog closes; defaults to the trigger. */
  onCloseAutoFocus?: DialogContentProps['onCloseAutoFocus'];
}

/**
 * Content of the assign / replace dialog (spec 01, Assign / replace dialog). Mount it inside an open
 * `Dialog`: its state, including the Idempotency-Key, lives as long as the dialog is open. The
 * key is made on the first submit, kept across retries after network errors and 5xx, and
 * replaced once the directory has stored an outcome for it (4xx), so corrected details are not
 * refused as a reused key.
 */
export function AssignDialogContent({
  commission,
  mode = 'assign',
  onAssigned,
  onCloseAutoFocus,
}: AssignDialogProps) {
  const id = useId();
  const idempotencyKey = useRef<string | null>(null);
  const alertsRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<DialogState>({
    draft: EMPTY_ASSIGN_DRAFT,
    errors: {},
    submitted: false,
    unmapped: [],
    alert: null,
    submitting: false,
  });
  const { draft, errors, submitting } = state;
  const controlId = (field: AssignField) => `${id}-${field}`;

  const change = (field: AssignField, value: string) => {
    setState((previous) => {
      const next = { ...previous.draft, [field]: value };
      return {
        ...previous,
        draft: next,
        errors: {
          ...previous.errors,
          [field]: previous.submitted ? checkAssignField(next, field) : undefined,
        },
      };
    });
  };

  /** Moves focus to the first invalid field, or else to the alerts, so the outcome is seen. */
  const focusFirstInvalid = (fieldErrors: AssignFieldErrors) => {
    const field = ASSIGN_FIELDS.find((name) => fieldErrors[name]);
    requestAnimationFrame(() => {
      if (field) document.getElementById(controlId(field))?.focus();
      else alertsRef.current?.focus();
    });
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const check = checkAssignDraft(draft);
    if (!check.ok) {
      setState((previous) => ({
        ...previous,
        errors: check.errors,
        submitted: true,
        unmapped: [],
        alert: null,
      }));
      focusFirstInvalid(check.errors);
      return;
    }

    setState((previous) => ({
      ...previous,
      errors: {},
      submitted: true,
      unmapped: [],
      alert: null,
      submitting: true,
    }));
    idempotencyKey.current ??= crypto.randomUUID();
    const result = await assignReportingOfficer({
      data: {
        slug: commission.slug,
        idempotencyKey: idempotencyKey.current,
        officer: check.officer,
      },
    }).catch(() => ({ ok: false as const, error: { kind: 'unavailable' as const, detail: null } }));
    setState((previous) => ({ ...previous, submitting: false }));

    if (result.ok) {
      onAssigned(result.data);
      return;
    }
    if (result.error.kind === 'unauthenticated') {
      window.location.assign(
        `/auth/login?returnTo=${encodeURIComponent(`/commissions/${commission.slug}`)}`,
      );
      return;
    }
    const failure = assignFailure(result.error);
    if (failure.newKey) idempotencyKey.current = null;
    setState((previous) => ({
      ...previous,
      errors: failure.fieldErrors,
      unmapped: failure.unmapped,
      alert: failure.alert,
    }));
    focusFirstInvalid(failure.fieldErrors);
  };

  const phone = normalisePhone(draft.phone);
  const replacing = mode === 'replace' ? commission.reportingOfficer : null;

  return (
    <DialogContent
      busy={submitting}
      onCloseAutoFocus={onCloseAutoFocus}
      className="max-w-[34rem] gap-0 p-0"
    >
      <DialogHeader className="flex-row items-center gap-3 px-6 pt-6 pb-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          {replacing ? (
            <ArrowRightLeft aria-hidden="true" className="size-[18px]" />
          ) : (
            <UserPlus aria-hidden="true" className="size-[18px]" />
          )}
        </span>
        <div className="grid min-w-0 gap-0.5">
          <DialogTitle>{replacing ? m.replaceTitle : m.assignTitle}</DialogTitle>
          <DialogDescription className="truncate">{commission.name}</DialogDescription>
        </div>
      </DialogHeader>

      <form noValidate onSubmit={(event) => void submit(event)} aria-busy={submitting}>
        <fieldset disabled={submitting} className="m-0 grid min-w-0 gap-5 border-0 px-6 pb-6">
          {replacing ? (
            <Alert variant="warning" role="status">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>{m.replaceWarning(replacing.name)}</AlertDescription>
            </Alert>
          ) : null}
          <div ref={alertsRef} tabIndex={-1} className="outline-none empty:hidden">
            {state.alert ? (
              <SubmitAlert
                alert={state.alert}
                unmapped={state.unmapped}
                fieldErrors={ASSIGN_FIELDS.some((field) => errors[field])}
              />
            ) : null}
          </div>

          <FormField label={m.officerFullName} error={errors.name} controlId={controlId('name')}>
            <Input
              value={draft.name}
              autoComplete="off"
              maxLength={130}
              onChange={(event) => {
                change('name', event.target.value);
              }}
            />
          </FormField>

          <FormField
            label={m.officerOfficialEmail}
            hint={m.officerEmailHint}
            error={errors.email}
            controlId={controlId('email')}
          >
            <Input
              type="email"
              value={draft.email}
              placeholder={m.officerEmailPlaceholder}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={260}
              onChange={(event) => {
                change('email', event.target.value);
              }}
            />
          </FormField>

          <FormField
            label={m.officerPhone}
            error={errors.phone}
            controlId={controlId('phone')}
            hint={
              <span className="grid gap-1">
                <span>{m.officerPhoneHint}</span>
                {phone && !errors.phone ? (
                  <span
                    aria-live="polite"
                    className="flex items-center gap-1.5 font-medium text-success-subtle-foreground"
                  >
                    <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.4} />
                    <span className="tabular-nums">
                      {m.officerPhoneSavedAs(formatPhone(phone))}
                    </span>
                  </span>
                ) : null}
              </span>
            }
          >
            <Input
              type="tel"
              value={draft.phone}
              placeholder={m.officerPhonePlaceholder}
              autoComplete="off"
              maxLength={40}
              className="tabular-nums"
              onChange={(event) => {
                change('phone', event.target.value);
              }}
            />
          </FormField>
        </fieldset>

        <div className="grid gap-4 border-t px-6 py-4">
          <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <Mail aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{m.assignOneEmail}</span>
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {m.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting} className="sm:min-w-44">
              {submitting ? (
                <>
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                  {m.assignSubmitting}
                </>
              ) : (
                <>
                  <Send aria-hidden="true" />
                  {m.assignSubmit}
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </DialogContent>
  );
}

function SubmitAlert({
  alert,
  unmapped,
  fieldErrors,
}: {
  alert: AssignAlert;
  /** Directory messages that name no field. */
  unmapped: string[];
  /** Whether any field shows an error the text can point to. */
  fieldErrors: boolean;
}) {
  const copy: Record<AssignAlert, { title: string; text?: string }> = {
    rejected: { title: m.assignRejected, text: fieldErrors ? m.assignRejectedText : undefined },
    error: { title: m.assignError, text: m.assignErrorText },
    'in-progress': { title: m.assignInProgress, text: m.assignInProgressText },
    changed: { title: m.assignChanged, text: m.assignChangedText },
    'officer-changed': { title: m.assignOfficerChanged, text: m.assignOfficerChangedText },
    'not-found': { title: m.assignNotFound },
    forbidden: { title: m.assignForbidden },
  };
  const { title, text } = copy[alert];
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      {text || unmapped.length > 0 ? (
        <AlertDescription>
          {text ? <p>{text}</p> : null}
          {unmapped.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {unmapped.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </AlertDescription>
      ) : null}
    </Alert>
  );
}
