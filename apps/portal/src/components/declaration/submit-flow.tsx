import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CheckboxItem,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatTime,
  Icon,
  IconTile,
  Spinner,
} from '@adili/ui';
import {
  Alert02Icon,
  AlertCircleIcon,
  RefreshIcon,
  SecurityCheckIcon,
  SentIcon,
} from '@hugeicons/core-free-icons';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { type Dispatch, useEffect, useReducer, useRef, useState } from 'react';

import { getStepUpStatus } from '../../server/step-up';
import { submitMyDeclaration } from '../../server/submission';
import { signInAgain, stepUp } from '../sign-in';
import {
  dialogOpen,
  initialSubmitState,
  problemMessage,
  SUBMIT_COPY,
  type StepUpMarker,
  stepUpConfirmed,
  type SubmitEvent,
  submitReducer,
  type SubmitState,
} from './submit';

export interface SubmitFlow {
  state: SubmitState;
  dispatch: Dispatch<SubmitEvent>;
  /** When the declarant entered the code on the step-up just returned from, if known. */
  confirmedAt: number | null;
  /** Sends the submit with the dialog's Idempotency-Key and hands the answer to the machine. */
  confirm: () => void;
  /** Reloads the summary after a conflict and closes the dialog. */
  reload: () => void;
}

/**
 * Runs the submit state machine for one declaration: handles the step-up return marker once
 * (asking the session whether the step-up is fresh, then dropping the marker from the URL so a
 * reload does not reopen the dialog), and performs the effects of each state. A marker on a
 * summary that cannot be submitted (it changed meanwhile) is dropped without opening anything.
 */
export function useSubmitFlow(
  declarationId: string,
  marker: StepUpMarker | null,
  canSubmit: boolean,
): SubmitFlow {
  const [state, dispatch] = useReducer(submitReducer, initialSubmitState);
  const navigate = useNavigate();
  const router = useRouter();
  const summaryPath = `/declarations/${declarationId}/summary`;
  const handled = useRef(false);
  const [confirmedAt, setConfirmedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!marker || handled.current) return;
    handled.current = true;
    void navigate({ to: '.', search: {}, replace: true });
    if (!canSubmit) return;
    const status = marker === 'done' ? getStepUpStatus().catch(() => null) : Promise.resolve(null);
    void status.then((session) => {
      const fresh = session?.status === 'ok' && session.fresh;
      if (fresh) setConfirmedAt(session.authTime);
      dispatch({
        type: 'step-up-returned',
        confirmed: stepUpConfirmed(marker, fresh),
        key: crypto.randomUUID(),
      });
    });
  }, [marker, canSubmit, navigate]);

  useEffect(() => {
    if (state.step === 'stepping-up') stepUp(summaryPath);
    if (state.step === 'signed-out') signInAgain(summaryPath);
    // The 400 says the draft changed since the summary loaded: read the summary and the
    // workspace header again, so the section nav and the blocking panel tell the same story.
    if (state.step === 'incomplete') void router.invalidate();
    if (state.step === 'submitted') {
      void navigate({ to: '/declarations/$id/submitted', params: { id: declarationId } });
    }
  }, [state.step, summaryPath, declarationId, navigate, router]);

  return {
    state,
    dispatch,
    confirmedAt,
    confirm: () => {
      if (state.step !== 'affirm' || !state.affirmed) return;
      if (state.problem !== null && state.problem !== 'error') return;
      const { key } = state;
      dispatch({ type: 'confirmed' });
      void submitMyDeclaration({ data: { declarationId, idempotencyKey: key } })
        .catch(() => ({ status: 'unavailable' }) as const)
        .then((answer) => {
          dispatch({ type: 'answered', answer });
        });
    },
    reload: () => {
      dispatch({ type: 'dialog-closed' });
      void router.invalidate();
    },
  };
}

/** Shown on the summary when the step-up failed or expired; restarts it. */
export function StepUpFailedAlert({ onRetry }: { onRetry: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <Alert ref={ref} variant="destructive" tabIndex={-1} className="outline-none">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{SUBMIT_COPY.stepUpFailed}</AlertTitle>
      <AlertDescription className="pt-2">
        <Button type="button" size="sm" onClick={onRetry}>
          <Icon icon={SecurityCheckIcon} />
          {SUBMIT_COPY.confirmIdentity}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export interface AffirmationDialogProps {
  flow: SubmitFlow;
  attestationText: string;
  statementDate: string;
  dueDate: string;
  /** Past the due date: submitting now files late. */
  late: boolean;
  /** The version an amendment files; null for a first submission. */
  nextVersion?: number | null;
}

/**
 * The affirmation (spec 06 FE-2): the solemn declaration, the "I affirm" checkbox, a late
 * warning when overdue, and Submit, which stays disabled until ticked. While submitting the
 * dialog cannot be closed; a failed submit keeps it open with the reason.
 */
export function AffirmationDialog({
  flow,
  attestationText,
  statementDate,
  dueDate,
  late,
  nextVersion = null,
}: AffirmationDialogProps) {
  const { state, dispatch, confirmedAt } = flow;
  const open = dialogOpen(state);
  const busy = state.step === 'submitting';
  const affirm = state.step === 'affirm' ? state : null;
  const problem = affirm?.problem ?? null;
  const canConfirm =
    affirm !== null && affirm.affirmed && (problem === null || problem === 'error');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dispatch({ type: 'dialog-closed' });
      }}
    >
      <DialogContent busy={busy} aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center gap-3">
          <IconTile tone="brand">
            <Icon icon={SentIcon} />
          </IconTile>
          <DialogTitle>{SUBMIT_COPY.title(nextVersion)}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {confirmedAt !== null ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-success">
              <Icon icon={SecurityCheckIcon} className="size-4" />
              {SUBMIT_COPY.identityConfirmed(formatTime(confirmedAt * 1000))}
            </p>
          ) : null}
          {late ? (
            <Alert variant="warning">
              <Icon icon={Alert02Icon} />
              <AlertDescription>{SUBMIT_COPY.late(dueDate)}</AlertDescription>
            </Alert>
          ) : null}
          <figure className="grid gap-1.5 rounded-lg bg-brand-faint p-4 ring-1 ring-brand-subtle-foreground/15">
            <figcaption className="text-[13px] font-medium text-muted-foreground">
              {SUBMIT_COPY.solemn}
            </figcaption>
            <blockquote className="text-[15px] leading-normal font-medium">
              "{attestationText}"
            </blockquote>
          </figure>
          <CheckboxItem
            label={SUBMIT_COPY.affirm}
            hint={SUBMIT_COPY.affirmHint}
            checked={busy || (affirm?.affirmed ?? false)}
            disabled={busy}
            onChange={(event) => {
              dispatch({ type: 'affirm-changed', affirmed: event.target.checked });
            }}
          />
          {problem ? (
            <Alert variant={problem === 'error' ? 'destructive' : 'warning'}>
              <Icon icon={AlertCircleIcon} />
              <AlertDescription className="grid justify-items-start gap-2">
                <p>{problemMessage(problem, { statementDate, dueDate })}</p>
                {problem === 'not-a-draft' ? (
                  <Button type="button" variant="secondary" size="sm" onClick={flow.reload}>
                    <Icon icon={RefreshIcon} />
                    {SUBMIT_COPY.reload}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              dispatch({ type: 'dialog-closed' });
            }}
          >
            {SUBMIT_COPY.cancel}
          </Button>
          <Button type="button" disabled={!canConfirm} onClick={flow.confirm}>
            {busy ? (
              <>
                <Spinner />
                {SUBMIT_COPY.submitting}
              </>
            ) : (
              <>
                <Icon icon={SentIcon} />
                {SUBMIT_COPY.submit}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
