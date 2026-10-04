import {
  addDays,
  Alert,
  AlertDescription,
  AlertTitle,
  ApprovalConsequences,
  type ApprovalConsequence,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  FieldError,
  formatDate,
  Icon,
  Label,
  Spinner,
  Textarea,
} from '@adili/ui';
import {
  BanIcon,
  BanknoteIcon,
  Building03Icon,
  Calendar03Icon,
  Cancel01Icon,
  File01Icon,
  HashtagIcon,
  InformationCircleIcon,
  Notification01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';
import { useId, useState } from 'react';

import { DialogFailure, DialogHeading, type FailureText } from '../dialog-parts';

import { isGraveStep, LADDER_WINDOW_DAYS } from '../../actions/ladder';
import type { ActionStep } from '../../server/actions.server';
import { en as m } from './messages';
import { type EarlierSteps, STEP_ICONS, WhatCameBefore } from './prior-steps';
import { stoppageCopy as stoppage } from './stoppage-messages';

/**
 * Approve, Decline and Restart for a ladder's step (spec 08 FE-5), as controlled dialogs. Each
 * hands its decision to `onSubmit`, which resolves to a failure to show in the dialog, or null
 * when the dialog may close. Headings and failures as the approvals inbox has them (`dialog-parts`).
 */

const NOTE_MAX = 2000;

function useSubmit(onSubmit: () => Promise<FailureText | null>) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FailureText | null>(null);
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
  personnelFileNumber?: string,
): ApprovalConsequence[] {
  const a = stoppage.approve;
  if (step === 'salary-stoppage') {
    return [
      { icon: HashtagIcon, title: a.adm, detail: a.admPayroll },
      {
        icon: BanknoteIcon,
        title: a.payroll,
        ...(personnelFileNumber ? { detail: a.payrollDetail(personnelFileNumber) } : {}),
        grave: true,
      },
      { icon: File01Icon, title: a.stoppageLetter, detail: a.letterDetail },
      {
        icon: Notification01Icon,
        title: m.consequences.notified(declarantName),
        detail: a.reinstatedDetail,
      },
    ];
  }
  if (step === 'disciplinary-referral') {
    return [
      { icon: HashtagIcon, title: m.consequences.reference },
      { icon: File01Icon, title: a.disciplinaryLetter, detail: a.disciplinaryLetterDetail },
      {
        icon: Building03Icon,
        title: a.reportingEntity,
        detail: a.reportingEntityDetail,
        grave: true,
      },
    ];
  }
  const days = LADDER_WINDOW_DAYS[step];
  return [
    { icon: HashtagIcon, title: m.consequences.reference },
    {
      icon: File01Icon,
      title: m.consequences.letter(step),
      detail: m.consequences.letterDetail,
    },
    ...(days === null
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

/**
 * Approve a drafted step, its consequences stated first. A salary stoppage or disciplinary
 * referral (#208, US 13) also shows what came before it in full (`earlier`: the earlier steps,
 * the declarant's responses, the stoppage's payroll acknowledgement) and cannot be approved until
 * that has loaded; a salary stoppage says first that it stops a salary, and the supervisor
 * confirms having read the notice, the warning and any responses.
 */
export function ApproveStepDialog({
  open,
  onOpenChange,
  step,
  declarantName,
  subjectTitle,
  personnelFileNumber,
  now,
  earlier,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: ActionStep;
  declarantName: string;
  subjectTitle: string;
  personnelFileNumber?: string;
  now: string;
  /** The steps before this one, for a grave step; unset for a notice or warning. */
  earlier?: EarlierSteps;
  onSubmit: () => Promise<FailureText | null>;
}) {
  const state = useSubmit(onSubmit);
  const [read, setRead] = useState(false);
  const readId = useId();
  const salary = step === 'salary-stoppage';
  const loaded = earlier === undefined || earlier.state === 'ok';
  const ready = loaded && (!salary || read);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          state.reset();
          setRead(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent busy={state.busy} className={earlier ? 'sm:max-w-[680px]' : undefined}>
        <DialogHeading
          icon={salary ? BanknoteIcon : STEP_ICONS[step]}
          tone={isGraveStep(step) ? 'destructive' : undefined}
          title={m.approveTitle(step)}
          description={`${declarantName} · ${subjectTitle}`}
        />
        <DialogBody className="grid gap-4">
          {salary ? (
            <Alert variant="destructive" role="note">
              <Icon icon={BanknoteIcon} />
              <AlertTitle>{stoppage.approve.payrollCallout(declarantName)}</AlertTitle>
            </Alert>
          ) : null}
          {earlier ? <WhatCameBefore earlier={earlier} /> : null}
          <ApprovalConsequences
            items={consequencesOf(step, declarantName, now, personnelFileNumber)}
            headingLevel={3}
          />
          {salary ? (
            <div className="flex items-start gap-2.5">
              <Checkbox
                id={readId}
                checked={read}
                disabled={!loaded || state.busy}
                onChange={(event) => {
                  setRead(event.target.checked);
                }}
              />
              <Label htmlFor={readId} className="font-normal">
                {stoppage.approve.read}
              </Label>
            </div>
          ) : null}
          <DialogFailure failure={state.failure} />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{m.cancel}</Button>
          </DialogClose>
          <Button
            variant={salary ? 'destructive' : 'default'}
            disabled={state.busy || !ready}
            onClick={() => void state.run()}
          >
            {state.busy ? <Spinner /> : salary ? <Icon icon={BanIcon} /> : null}
            {salary ? stoppage.approve.confirmStoppage : m.approveAndIssue}
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
  onSubmit: (note: string) => Promise<FailureText | null>;
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
        <DialogHeading
          icon={Cancel01Icon}
          tone="destructive"
          title={m.declineTitle(step)}
          description={declarantName}
        />
        <DialogBody className="grid gap-4">
          <Alert variant="warning" role="note">
            <Icon icon={InformationCircleIcon} />
            <AlertDescription>{m.declineWarning(step)}</AlertDescription>
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
          <DialogFailure failure={state.failure} />
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
  onSubmit: () => Promise<FailureText | null>;
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
        <DialogHeading
          icon={RefreshIcon}
          title={m.restartTitle}
          description={m.restartBody(step)}
        />
        {state.failure ? (
          <DialogBody>
            <DialogFailure failure={state.failure} />
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
