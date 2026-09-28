import {
  Alert,
  AlertTitle,
  Button,
  CardIcon,
  DialogBody,
  DialogClose,
  DialogContent,
  type DialogContentProps,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  FormField,
  Icon,
  Input,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  Calendar03Icon,
  InformationCircleIcon,
  Loading03Icon,
  Logout03Icon,
} from '@hugeicons/core-free-icons';
import { type SyntheticEvent, useId, useReducer, useRef, useState } from 'react';

import type { ExitsResult } from '../../server/directory/client';
import { confirmRosterExits } from '../../server/roster-exits';
import { goToSignIn } from '../sign-in-redirect';
import {
  checkExits,
  type ExitDateErrors,
  exitDatesReducer,
  type ExitingOfficer,
  exitsFailure,
  initialExitDates,
  todayInNairobi,
} from './exits';
import { messages as m } from './messages';

const NO_ERRORS: ExitDateErrors = { overrides: {} };

export interface ConfirmExitsDialogProps {
  slug: string;
  /** The officers to exit: the selection, or the one record on its page. */
  officers: readonly ExitingOfficer[];
  /** The exits were recorded; the dialog is done. */
  onConfirmed: (result: ExitsResult) => void;
  /** Some officers changed since the page loaded; nothing was recorded. */
  onStale: (message: string) => void;
  onCloseAutoFocus?: DialogContentProps['onCloseAutoFocus'];
}

/**
 * Content of the confirm exits dialog (spec 02, Screen: Flagged officers). Mount it inside an open
 * `Dialog`: its dates and Idempotency-Key live as long as the dialog is open. One exit date
 * applies to everyone; "Set per officer" gives any of them their own. The key is kept across
 * retries after network errors and 5xx, and replaced once the directory answered.
 */
export function ConfirmExitsDialogContent({
  slug,
  officers,
  onConfirmed,
  onStale,
  onCloseAutoFocus,
}: ConfirmExitsDialogProps) {
  const id = useId();
  const today = todayInNairobi();
  const [dates, dispatch] = useReducer(exitDatesReducer, today, initialExitDates);
  const [errors, setErrors] = useState<ExitDateErrors>(NO_ERRORS);
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** "Set per officer" is open; it opens by itself when one of those dates needs fixing. */
  const [perOfficer, setPerOfficer] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const single = officers.length === 1 ? officers[0] : undefined;
  const dateId = `${id}-date`;
  const overrideId = (officer: ExitingOfficer) => `${id}-date-${officer.id}`;

  /** Focus the first date to fix, or else the alert, so the outcome is seen. */
  const focusProblem = (fieldErrors: ExitDateErrors) => {
    if (Object.keys(fieldErrors.overrides).length > 0) setPerOfficer(true);
    requestAnimationFrame(() => {
      if (fieldErrors.exitDate) {
        document.getElementById(dateId)?.focus();
        return;
      }
      const officer = officers.find((candidate) => fieldErrors.overrides[candidate.id]);
      if (officer) document.getElementById(overrideId(officer))?.focus();
      else alertRef.current?.focus();
    });
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const check = checkExits(officers, dates, todayInNairobi());
    if (!check.ok) {
      setErrors(check.errors);
      setAlert(null);
      focusProblem(check.errors);
      return;
    }
    setErrors(NO_ERRORS);
    setAlert(null);
    setBusy(true);
    idempotencyKey.current ??= crypto.randomUUID();
    const result = await confirmRosterExits({
      data: { slug, idempotencyKey: idempotencyKey.current, exits: check.exits },
    }).catch(() => ({ ok: false as const, error: { kind: 'unavailable' as const, detail: null } }));
    setBusy(false);
    if (result.ok) {
      onConfirmed(result.data);
      return;
    }
    const failure = exitsFailure(officers, result.error);
    if (failure.kind === 'sign-in') {
      goToSignIn();
      return;
    }
    if (failure.kind === 'stale') {
      onStale(failure.message);
      return;
    }
    if (failure.newKey) idempotencyKey.current = null;
    setErrors(failure.errors);
    setAlert(failure.message);
    focusProblem(failure.errors);
  };

  return (
    <DialogContent busy={busy} onCloseAutoFocus={onCloseAutoFocus} className="sm:max-w-[600px]">
      <form noValidate onSubmit={(event) => void submit(event)} className="contents">
        <DialogHeader className="flex-row items-center gap-3">
          <CardIcon className="mb-0">
            <Icon icon={Logout03Icon} />
          </CardIcon>
          <div className="min-w-0">
            <DialogTitle>{m.exitsTitle(officers.length)}</DialogTitle>
            {single ? (
              <p className="mt-0.5 truncate text-[13.5px] text-muted-foreground">
                {single.fullName} ·{' '}
                <span className="font-mono text-[13px]">{single.personnelFileNumber}</span>
              </p>
            ) : null}
          </div>
        </DialogHeader>
        <DialogBody className="gap-4">
          {alert ? (
            <Alert
              ref={alertRef}
              variant="destructive"
              role="alert"
              tabIndex={-1}
              className="outline-none"
            >
              <Icon icon={AlertCircleIcon} />
              <AlertTitle>{alert}</AlertTitle>
            </Alert>
          ) : null}
          <FormField
            label={m.exitsDate}
            hint={single ? m.exitDateHint : m.exitsDateHint}
            error={errors.exitDate}
            controlId={dateId}
          >
            <Input
              type="date"
              max={today}
              value={dates.exitDate}
              disabled={busy}
              className="max-w-[220px]"
              onChange={(event) => {
                dispatch({ type: 'exit-date', date: event.target.value });
              }}
            />
          </FormField>
          {single ? null : (
            <details
              open={perOfficer}
              onToggle={(event) => {
                setPerOfficer(event.currentTarget.open);
              }}
              className="group rounded-lg shadow-control"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3.5 py-3 text-[14.5px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <Icon icon={Calendar03Icon} className="size-4 text-secondary-foreground" />
                {m.exitsPerOfficer}
                <Icon
                  icon={ArrowDown01Icon}
                  className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="border-t px-3.5 py-2.5 text-[13px] text-muted-foreground">
                {m.exitsPerOfficerHint}
              </p>
              <ul>
                {officers.map((officer) => {
                  const error = errors.overrides[officer.id];
                  const errorId = `${overrideId(officer)}-error`;
                  return (
                    <li
                      key={officer.id}
                      className="grid items-center gap-2.5 border-t px-3.5 py-2.5 min-[520px]:grid-cols-[minmax(0,1fr)_170px]"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{officer.fullName}</p>
                        <p className="truncate font-mono text-[12.5px] text-muted-foreground">
                          {officer.personnelFileNumber}
                        </p>
                      </div>
                      <div className="grid gap-1.5">
                        <label htmlFor={overrideId(officer)} className="sr-only">
                          {m.exitDateFor(officer.fullName)}
                        </label>
                        <Input
                          id={overrideId(officer)}
                          type="date"
                          max={today}
                          value={dates.overrides[officer.id] ?? ''}
                          disabled={busy}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? errorId : undefined}
                          className="h-[38px] text-sm"
                          onChange={(event) => {
                            dispatch({
                              type: 'override',
                              id: officer.id,
                              date: event.target.value,
                            });
                          }}
                        />
                      </div>
                      {error ? (
                        <FieldError id={errorId} className="min-[520px]:col-span-2">
                          {error}
                        </FieldError>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
          <DialogDescription asChild>
            <Alert variant="info" role="note">
              <Icon icon={InformationCircleIcon} />
              <AlertTitle className="font-normal">{m.exitsNote}</AlertTitle>
            </Alert>
          </DialogDescription>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {m.exitsCancel}
            </Button>
          </DialogClose>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <>
                <Icon icon={Loading03Icon} className="animate-spin" />
                {m.exitsRecording}
              </>
            ) : (
              m.exitsConfirm(officers.length)
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
