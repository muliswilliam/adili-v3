import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CardIcon,
  DialogBody,
  DialogClose,
  DialogContent,
  type DialogContentProps,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Icon,
  Input,
} from '@adili/ui';
import {
  Alert02Icon,
  AlertCircleIcon,
  ArrowDataTransferHorizontalIcon,
  InformationCircleIcon,
  Loading03Icon,
  Mail01Icon,
  SentIcon,
  Tick02Icon,
  UserAdd01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type SyntheticEvent, useEffect, useId, useRef, useState } from 'react';

import { assignReportingOfficer } from '../../server/commissions';
import type { Commission } from '../../server/directory/client';
import { goToSignIn } from '../sign-in-redirect';
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
   * `replace` when the Commission has an officer: the dialog warns that they lose reporting officer access. The
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
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  /** An officer was assigned without the page knowing (the email failed); reload it on close. */
  const assignedUnseen = useRef(false);
  useEffect(
    () => () => {
      if (assignedUnseen.current) void router.invalidate();
    },
    [router],
  );
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
      goToSignIn(`/commissions/${commission.slug}`);
      return;
    }
    const failure = assignFailure(result.error);
    if (failure.newKey) idempotencyKey.current = null;
    if (failure.alert === 'not-sent') assignedUnseen.current = true;
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
  // The current officer's own email: the directory corrects their details instead of replacing
  // them, and an activated officer gets no email.
  const correcting =
    replacing !== null && draft.email.trim().toLowerCase() === replacing.email.toLowerCase();
  const savesOnly = correcting && replacing.state === 'activated';

  return (
    <DialogContent
      busy={submitting}
      onCloseAutoFocus={onCloseAutoFocus}
      aria-describedby={undefined}
    >
      <DialogHeader className="flex-row items-center gap-3">
        <CardIcon className="mb-0">
          <Icon icon={replacing ? ArrowDataTransferHorizontalIcon : UserAdd01Icon} />
        </CardIcon>
        <DialogTitle>
          {correcting ? m.correctTitle : replacing ? m.replaceTitle : m.assignTitle}
        </DialogTitle>
      </DialogHeader>

      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-busy={submitting}
        className="flex min-h-0 flex-1 flex-col"
      >
        <DialogBody>
          {/* Disabling the fieldset disables every control while the request is in flight. */}
          <fieldset disabled={submitting} className="m-0 grid min-w-0 gap-[18px] border-0 p-0">
            {replacing && correcting ? (
              <Alert variant="info" role="status">
                <Icon icon={InformationCircleIcon} />
                <AlertDescription>{m.correctNotice(replacing.name)}</AlertDescription>
              </Alert>
            ) : replacing ? (
              <Alert variant="warning" role="status">
                <Icon icon={Alert02Icon} />
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

            <div className="grid gap-1.5">
              <FormField
                label={m.officerPhone}
                hint={m.officerPhoneHint}
                error={errors.phone}
                controlId={controlId('phone')}
              >
                <Input
                  type="tel"
                  value={draft.phone}
                  placeholder={m.officerPhonePlaceholder}
                  autoComplete="off"
                  maxLength={40}
                  className="tabular-nums"
                  aria-describedby={`${controlId('phone')}-saved`}
                  onChange={(event) => {
                    change('phone', event.target.value);
                  }}
                />
              </FormField>
              {/* Under the field, as in the prototype: what the number will be stored as. */}
              <p
                id={`${controlId('phone')}-saved`}
                aria-live="polite"
                className="flex items-center gap-1.5 text-[13px] font-medium text-success empty:hidden"
              >
                {phone && !errors.phone ? (
                  <>
                    <Icon icon={Tick02Icon} className="size-3.5" strokeWidth={2.4} />
                    <span className="tabular-nums">
                      {m.officerPhoneSavedAs(formatPhone(phone))}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </fieldset>
        </DialogBody>

        <p className="flex shrink-0 items-start gap-2 border-t px-5 pt-3.5 text-[13px] text-muted-foreground sm:px-6 sm:pt-4">
          <Icon icon={Mail01Icon} className="mt-0.5 size-3.5" />
          <span>
            {savesOnly ? m.correctNoEmail : correcting ? m.correctEmailAgain : m.assignOneEmail}
          </span>
        </p>
        <DialogFooter className="border-t-0 pt-3 sm:pt-3">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {m.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Icon icon={Loading03Icon} className="animate-spin" />
                {savesOnly ? m.correctSubmitting : m.assignSubmitting}
              </>
            ) : (
              <>
                <Icon icon={savesOnly ? Tick02Icon : SentIcon} />
                {savesOnly ? m.correctSubmit : m.assignSubmit}
              </>
            )}
          </Button>
        </DialogFooter>
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
    'not-sent': { title: m.assignNotSent, text: m.assignNotSentText },
    'in-progress': { title: m.assignInProgress, text: m.assignInProgressText },
    busy: { title: m.assignBusy, text: m.assignBusyText },
    changed: { title: m.assignChanged, text: m.assignChangedText },
    'officer-changed': { title: m.assignOfficerChanged, text: m.assignOfficerChangedText },
    'not-found': { title: m.assignNotFound },
    forbidden: { title: m.assignForbidden },
  };
  const { title, text } = copy[alert];
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
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
