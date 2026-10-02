import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CardIcon,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Icon,
  Input,
  Select,
  SelectItem,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Loading03Icon,
  Mail01Icon,
  SentIcon,
  Tick02Icon,
  UserAdd01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type SyntheticEvent, useEffect, useId, useRef, useState } from 'react';

import type { Agency, LeaOfficerAccount } from '../../server/directory/client';
import { provisionLeaOfficer } from '../../server/lea-accounts';
import {
  type AssignDraft,
  type AssignField,
  type AssignFieldErrors,
  checkAssignDraft,
  checkAssignField,
  EMPTY_ASSIGN_DRAFT,
} from '../commissions/assign-form';
import { formatPhone, normalisePhone } from '../commissions/phone';
import { goToSignIn } from '../sign-in-redirect';
import { messages as m } from './messages';
import { type ProvisionAlert, provisionFailure } from './provision-form';

const FIELDS: readonly AssignField[] = ['name', 'email', 'phone'];

interface DialogState {
  agency: string;
  draft: AssignDraft;
  errors: AssignFieldErrors;
  /** Set after the first submit: fields are then re-checked as they change. */
  submitted: boolean;
  unmapped: string[];
  alert: ProvisionAlert | null;
  submitting: boolean;
}

/**
 * Content of the provision dialog (spec 10 FE-6, S11): an officer of an agency, by name,
 * official email and phone; the directory creates their console account (role
 * `law-enforcement`, tenant `lea`) and sends one activation email. Mount it inside an open
 * `Dialog`: its state, including the Idempotency-Key, lives as long as the dialog is open. The
 * key is kept across retries after network errors and 5xx and replaced once the directory has
 * stored an outcome (4xx).
 */
export function ProvisionDialogContent({
  agencies,
  agencyCode,
  onProvisioned,
}: {
  agencies: Agency[];
  /** The agency whose page opened the dialog. */
  agencyCode: string;
  onProvisioned: (officer: LeaOfficerAccount) => void;
}) {
  const id = useId();
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  /** Provisioned without the page knowing (the email failed); reload it on close. */
  const provisionedUnseen = useRef(false);
  useEffect(
    () => () => {
      if (provisionedUnseen.current) void router.invalidate();
    },
    [router],
  );
  const alertsRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<DialogState>({
    agency: agencyCode,
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

  const focusFirstInvalid = (fieldErrors: AssignFieldErrors) => {
    const field = FIELDS.find((name) => fieldErrors[name]);
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
    const result = await provisionLeaOfficer({
      data: { code: state.agency, idempotencyKey: idempotencyKey.current, officer: check.officer },
    }).catch(() => ({ ok: false as const, error: { kind: 'unavailable' as const, detail: null } }));
    setState((previous) => ({ ...previous, submitting: false }));

    if (result.ok) {
      onProvisioned(result.data);
      return;
    }
    if (result.error.kind === 'unauthenticated') {
      goToSignIn();
      return;
    }
    const failure = provisionFailure(result.error);
    if (failure.newKey) idempotencyKey.current = null;
    if (failure.alert === 'not-sent') provisionedUnseen.current = true;
    setState((previous) => ({
      ...previous,
      errors: failure.fieldErrors,
      unmapped: failure.unmapped,
      alert: failure.alert,
    }));
    focusFirstInvalid(failure.fieldErrors);
  };

  const phone = normalisePhone(draft.phone);

  return (
    <DialogContent busy={submitting} aria-describedby={undefined}>
      <DialogHeader className="flex-row items-center gap-3">
        <CardIcon className="mb-0">
          <Icon icon={UserAdd01Icon} />
        </CardIcon>
        <DialogTitle>{m.provisionTitle}</DialogTitle>
      </DialogHeader>

      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-busy={submitting}
        className="flex min-h-0 flex-1 flex-col"
      >
        <DialogBody>
          <fieldset disabled={submitting} className="m-0 grid min-w-0 gap-[18px] border-0 p-0">
            <div ref={alertsRef} tabIndex={-1} className="outline-none empty:hidden">
              {state.alert ? (
                <SubmitAlert
                  alert={state.alert}
                  unmapped={state.unmapped}
                  fieldErrors={FIELDS.some((field) => errors[field])}
                />
              ) : null}
            </div>

            <FormField label={m.agency} controlId={`${id}-agency`}>
              <Select
                value={state.agency}
                onValueChange={(agency) => {
                  // Another agency is another request: a new key.
                  idempotencyKey.current = null;
                  setState((previous) => ({ ...previous, agency }));
                }}
              >
                {agencies.map((agency) => (
                  <SelectItem key={agency.code} value={agency.code}>
                    {`${agency.code} · ${agency.name}`}
                  </SelectItem>
                ))}
              </Select>
            </FormField>

            <FormField label={m.fullName} error={errors.name} controlId={controlId('name')}>
              <Input
                value={draft.name}
                placeholder={m.namePlaceholder}
                autoComplete="off"
                maxLength={130}
                onChange={(event) => {
                  change('name', event.target.value);
                }}
              />
            </FormField>

            <FormField
              label={m.officialEmail}
              hint={m.emailHint}
              error={errors.email}
              controlId={controlId('email')}
            >
              <Input
                type="email"
                value={draft.email}
                placeholder={m.emailPlaceholder}
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
                label={m.phone}
                hint={m.phoneHint}
                error={errors.phone}
                controlId={controlId('phone')}
              >
                <Input
                  type="tel"
                  value={draft.phone}
                  placeholder={m.phonePlaceholder}
                  autoComplete="off"
                  maxLength={40}
                  className="tabular-nums"
                  aria-describedby={`${controlId('phone')}-saved`}
                  onChange={(event) => {
                    change('phone', event.target.value);
                  }}
                />
              </FormField>
              <p
                id={`${controlId('phone')}-saved`}
                aria-live="polite"
                className="flex items-center gap-1.5 text-[13px] font-medium text-success empty:hidden"
              >
                {phone && !errors.phone ? (
                  <>
                    <Icon icon={Tick02Icon} className="size-3.5" strokeWidth={2.4} />
                    <span className="tabular-nums">{m.phoneSavedAs(formatPhone(phone))}</span>
                  </>
                ) : null}
              </p>
            </div>
          </fieldset>
        </DialogBody>

        <p className="flex shrink-0 items-start gap-2 border-t px-5 pt-3.5 text-[13px] text-muted-foreground sm:px-6 sm:pt-4">
          <Icon icon={Mail01Icon} className="mt-0.5 size-3.5" />
          <span>{m.oneEmail}</span>
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
                {m.sending}
              </>
            ) : (
              <>
                <Icon icon={SentIcon} />
                {m.sendActivation}
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
  alert: ProvisionAlert;
  unmapped: string[];
  fieldErrors: boolean;
}) {
  const copy: Record<ProvisionAlert, { title: string; text?: string }> = {
    rejected: { title: m.rejected, text: fieldErrors ? m.rejectedText : undefined },
    error: { title: m.failed, text: m.failedText },
    'not-sent': { title: m.notSent, text: m.notSentText },
    'in-progress': { title: m.inProgress, text: m.inProgressText },
    busy: { title: m.busy, text: m.busyText },
    changed: { title: m.changed, text: m.changedText },
    'not-found': { title: m.agencyGone },
    forbidden: { title: m.forbiddenAction },
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
