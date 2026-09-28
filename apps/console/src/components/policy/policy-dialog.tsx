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
} from '@adili/ui';
import {
  AlertCircleIcon,
  Calendar03Icon,
  InformationCircleIcon,
  Loading03Icon,
} from '@hugeicons/core-free-icons';
import { type SyntheticEvent, useId, useRef, useState } from 'react';

import type { DirectoryResult, TenantPolicyVersion } from '../../server/directory/client';
import { formatDate } from '../format';
import { messages as m } from './messages';
import { checkStartDate, type PolicyAlert, policyFailure } from './policy-form';

/** Creates the new version; the page passes the server function so tests can stand in for it. */
export type SavePolicyVersion = (input: {
  idempotencyKey: string;
  obligationsStartDate: string;
}) => Promise<DirectoryResult<TenantPolicyVersion>>;

export interface PolicyDialogProps {
  /** The version in force when the dialog opened. */
  current: TenantPolicyVersion;
  save: SavePolicyVersion;
  onSaved: (version: TenantPolicyVersion) => void;
  onUnauthenticated: () => void;
}

interface DialogState {
  date: string;
  error: string | undefined;
  /** Set after the first submit: the date is then re-checked as it changes. */
  submitted: boolean;
  alert: PolicyAlert | null;
  unmapped: string[];
  submitting: boolean;
}

/**
 * Content of the "Change obligations start date" dialog (spec 04 FE-4, S19). Mount it inside an
 * open `Dialog`: its state, including the Idempotency-Key, lives as long as the dialog is open.
 * The key is made on the first submit, kept across retries after network errors and 5xx, and
 * replaced once the directory has stored an outcome for it (4xx).
 */
export function PolicyDialogContent({
  current,
  save,
  onSaved,
  onUnauthenticated,
}: PolicyDialogProps) {
  const id = useId();
  const dateId = `${id}-date`;
  const idempotencyKey = useRef<string | null>(null);
  const alertsRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<DialogState>({
    date: current.obligationsStartDate,
    error: undefined,
    submitted: false,
    alert: null,
    unmapped: [],
    submitting: false,
  });
  const { submitting } = state;

  const focusOutcome = (fieldError: string | undefined) => {
    requestAnimationFrame(() => {
      if (fieldError) document.getElementById(dateId)?.focus();
      else alertsRef.current?.focus();
    });
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const error = checkStartDate(state.date, current.obligationsStartDate);
    if (error) {
      setState((previous) => ({ ...previous, error, submitted: true, alert: null, unmapped: [] }));
      focusOutcome(error);
      return;
    }
    setState((previous) => ({
      ...previous,
      error: undefined,
      submitted: true,
      alert: null,
      unmapped: [],
      submitting: true,
    }));
    idempotencyKey.current ??= crypto.randomUUID();
    const result = await save({
      idempotencyKey: idempotencyKey.current,
      obligationsStartDate: state.date,
    }).catch(() => ({ ok: false as const, error: { kind: 'unavailable' as const, detail: null } }));
    setState((previous) => ({ ...previous, submitting: false }));
    if (result.ok) {
      onSaved(result.data);
      return;
    }
    if (result.error.kind === 'unauthenticated') {
      onUnauthenticated();
      return;
    }
    const failure = policyFailure(result.error);
    if (failure.newKey) idempotencyKey.current = null;
    setState((previous) => ({
      ...previous,
      error: failure.fieldError,
      alert: failure.alert,
      unmapped: failure.unmapped,
    }));
    focusOutcome(failure.fieldError);
  };

  return (
    <DialogContent busy={submitting} aria-describedby={undefined}>
      <DialogHeader className="flex-row items-center gap-3">
        <CardIcon className="mb-0">
          <Icon icon={Calendar03Icon} />
        </CardIcon>
        <DialogTitle>{m.dialogTitle}</DialogTitle>
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
                <SaveAlert
                  alert={state.alert}
                  unmapped={state.unmapped}
                  version={current.version}
                />
              ) : null}
            </div>
            <p className="flex items-center gap-2.5 rounded-lg bg-muted px-3.5 py-2.5 text-sm text-secondary-foreground">
              <Icon icon={Calendar03Icon} className="size-4 shrink-0" />
              <span>
                {m.currentStartDate}{' '}
                <b className="font-semibold text-foreground">
                  {formatDate(current.obligationsStartDate)}
                </b>{' '}
                {m.currentVersion(current.version)}
              </span>
            </p>
            <FormField
              label={m.startDate}
              hint={m.startDateHint}
              error={state.error}
              controlId={dateId}
            >
              <Input
                type="date"
                required
                value={state.date}
                // As a block, Chrome puts the picker button at the far end of the field.
                className="block tabular-nums"
                onChange={(event) => {
                  const date = event.target.value;
                  setState((previous) => ({
                    ...previous,
                    date,
                    error: previous.submitted
                      ? checkStartDate(date, current.obligationsStartDate)
                      : undefined,
                  }));
                }}
              />
            </FormField>
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Icon icon={InformationCircleIcon} className="size-3.5 shrink-0" />
              <span>{m.savesAs(current.version + 1)}</span>
            </p>
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {m.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" disabled={submitting} className="min-w-[220px]">
            {submitting ? (
              <>
                <Icon icon={Loading03Icon} className="animate-spin" />
                {m.submitting}
              </>
            ) : (
              m.submit
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function SaveAlert({
  alert,
  unmapped,
  version,
}: {
  alert: PolicyAlert;
  unmapped: string[];
  /** The version still in force. */
  version: number;
}) {
  const copy: Record<PolicyAlert, { title: string; text?: string }> = {
    error: { title: m.saveError, text: m.saveErrorText(version) },
    rejected: { title: m.saveRejected },
    'in-progress': { title: m.saveInProgress, text: m.saveInProgressText },
    changed: { title: m.saveChanged, text: m.saveChangedText },
    forbidden: { title: m.saveForbidden },
    'not-found': { title: m.saveNotFound },
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
