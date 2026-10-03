import {
  addDays,
  Alert,
  AlertDescription,
  AlertTitle,
  ApprovalConsequences,
  type ApprovalConsequence,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  formatDate,
  Icon,
  IconTile,
  Label,
  Spinner,
  Textarea,
} from '@adili/ui';
import {
  AlertCircleIcon,
  BanIcon,
  Calendar03Icon,
  Cancel01Icon,
  File01Icon,
  HashtagIcon,
  InformationCircleIcon,
  Mail01Icon,
  Notification01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';
import { useId, useState } from 'react';

import type { ActionStep } from '../../server/actions.server';
import { en as m } from './messages';

/**
 * Approve, Decline and Restart for a ladder's step (spec 08 FE-5), as controlled dialogs. Each
 * hands its decision to `onSubmit`, which resolves to a failure to show in the dialog, or null
 * when the dialog may close.
 */

const NOTE_MAX = 2000;

/** Days each step gives the declarant to act, by tenant policy (`ladder.*WindowDays`). */
const WINDOW_DAYS: Partial<Record<ActionStep, number>> = {
  'notice-to-comply': 14,
  warning: 14,
  'salary-stoppage': 30,
};

function Failure({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Alert variant="destructive" role="alert">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{text}</AlertTitle>
    </Alert>
  );
}

function useSubmit(onSubmit: () => Promise<string | null>) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return {
    busy,
    failure,
    reset: () => {
      setFailure(null);
    },
    run: async () => {
      setFailure(null);
      setBusy(true);
      const failed = await onSubmit();
      setBusy(false);
      setFailure(failed);
    },
  };
}

/** What approving the step does, in text (spec 08 accessibility). */
export function consequencesOf(
  step: ActionStep,
  declarantName: string,
  now: string,
): ApprovalConsequence[] {
  const days = WINDOW_DAYS[step];
  const grave = step === 'salary-stoppage' || step === 'disciplinary-referral';
  return [
    { icon: HashtagIcon, title: m.consequences.reference },
    {
      icon: grave ? BanIcon : File01Icon,
      title: m.consequences.letter(step),
      detail: m.consequences.letterDetail,
      grave,
    },
    ...(days === undefined
      ? []
      : [
          {
            icon: Calendar03Icon,
            title: m.consequences.actBy(formatDate(addDays(now, days))),
            detail: m.consequences.actByDetail(days),
          },
        ]),
    {
      icon: Notification01Icon,
      title: m.consequences.notified(declarantName),
      detail: m.consequences.notifiedDetail,
    },
  ];
}

export function ApproveStepDialog({
  open,
  onOpenChange,
  step,
  declarantName,
  subjectTitle,
  now,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: ActionStep;
  declarantName: string;
  subjectTitle: string;
  now: string;
  onSubmit: () => Promise<string | null>;
}) {
  const state = useSubmit(onSubmit);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) state.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent busy={state.busy}>
        <DialogHeader className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3">
          <IconTile size="sm" className="row-span-2">
            <Icon icon={Mail01Icon} />
          </IconTile>
          <DialogTitle>{m.approveTitle(step)}</DialogTitle>
          <DialogDescription>{`${declarantName} · ${subjectTitle}`}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <ApprovalConsequences items={consequencesOf(step, declarantName, now)} headingLevel={3} />
          <Failure text={state.failure} />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{m.cancel}</Button>
          </DialogClose>
          <Button disabled={state.busy} onClick={() => void state.run()}>
            {state.busy ? <Spinner /> : null}
            {m.approveAndIssue}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeclineStepDialog({
  open,
  onOpenChange,
  step,
  declarantName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: ActionStep;
  declarantName: string;
  onSubmit: (note: string) => Promise<string | null>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const state = useSubmit(() => onSubmit(note.trim()));
  const fieldId = useId();
  const tooLong = note.length > NOTE_MAX;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          state.reset();
          setNote('');
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent busy={state.busy}>
        <DialogHeader className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3">
          <IconTile size="sm" tone="destructive" className="row-span-2">
            <Icon icon={Cancel01Icon} />
          </IconTile>
          <DialogTitle>{m.declineTitle(step)}</DialogTitle>
          <DialogDescription>{declarantName}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <Alert variant="warning" role="note">
            <Icon icon={InformationCircleIcon} />
            <AlertDescription>{m.declineWarning}</AlertDescription>
          </Alert>
          <div className="grid gap-1.5">
            <Label htmlFor={fieldId}>{m.note}</Label>
            <Textarea
              id={fieldId}
              rows={4}
              value={note}
              placeholder={m.notePlaceholder}
              aria-invalid={error || tooLong ? true : undefined}
              aria-describedby={`${fieldId}-help`}
              onChange={(event) => {
                setNote(event.target.value);
                if (error) setError(null);
              }}
            />
            <div className="flex items-start justify-between gap-3">
              {error || tooLong ? (
                <FieldError id={`${fieldId}-help`}>{error ?? m.noteTooLong}</FieldError>
              ) : (
                <span id={`${fieldId}-help`} />
              )}
              <span
                className={
                  tooLong
                    ? 'ml-auto text-xs font-medium text-destructive'
                    : 'ml-auto text-xs text-muted-foreground'
                }
              >
                {m.noteCounter(note.length)}
              </span>
            </div>
          </div>
          <Failure text={state.failure} />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{m.cancel}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={state.busy}
            onClick={() => {
              if (!note.trim()) {
                setError(m.noteMissing);
                return;
              }
              if (tooLong) return;
              void state.run();
            }}
          >
            {state.busy ? <Spinner /> : null}
            {m.decline}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RestartLadderDialog({
  open,
  onOpenChange,
  step,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: ActionStep;
  onSubmit: () => Promise<string | null>;
}) {
  const state = useSubmit(onSubmit);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) state.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent busy={state.busy}>
        <DialogHeader className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3">
          <IconTile size="sm" className="row-span-2">
            <Icon icon={RefreshIcon} />
          </IconTile>
          <DialogTitle>{m.restartTitle}</DialogTitle>
          <DialogDescription>{m.restartBody(step)}</DialogDescription>
        </DialogHeader>
        {state.failure ? (
          <DialogBody>
            <Failure text={state.failure} />
          </DialogBody>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{m.cancel}</Button>
          </DialogClose>
          <Button disabled={state.busy} onClick={() => void state.run()}>
            {state.busy ? <Spinner /> : <Icon icon={RefreshIcon} />}
            {m.restart}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
