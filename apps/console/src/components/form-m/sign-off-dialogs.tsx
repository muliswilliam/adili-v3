import {
  Alert,
  AlertDescription,
  Button,
  CheckboxItem,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  formatDate,
  Icon,
  type IconProps,
  IconTile,
  Input,
  Spinner,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Clock01Icon,
  HashtagIcon,
  Notification03Icon,
  SecurityCheckIcon,
  SentIcon,
  SquareLock02Icon,
  UserCheck01Icon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import { type SyntheticEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

import type { FormMResult } from '../../server/form-m.server';
import { refusalOf } from '../../server/reporting/refusals';
import type { ConfirmRefusal, ConfirmState } from './confirm';
import { FORM_M_ANCHORS } from './form-m-document';
import { messages as m } from './sign-off-messages';

/** The supervisor's "Mark Form M reviewed": their name, today and the designation they give. */
export function MarkReviewedDialog({
  name,
  today,
  onClose,
  onMark,
  onSignedOut,
}: {
  name: string;
  /** Today in Nairobi, `YYYY-MM-DD`. */
  today: string;
  onClose: () => void;
  /** Marks the draft reviewed; the dialog closes once it is. */
  onMark: (designation: string) => Promise<FormMResult<null>>;
  /** The session ended: sign in again. */
  onSignedOut: () => void;
}) {
  const formId = useId();
  const [designation, setDesignation] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const error = submitted && !designation.trim() ? m.designationRequired : undefined;
  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!designation.trim()) return;
    setBusy(true);
    setFailure(null);
    const outcome = await onMark(designation.trim());
    setBusy(false);
    if (outcome.ok) onClose();
    else if (outcome.error.kind === 'unauthenticated') onSignedOut();
    else setFailure(reviewFailure(outcome));
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent busy={busy} aria-describedby={`${formId}-text`}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile>
            <Icon icon={UserCheck01Icon} />
          </IconTile>
          <DialogTitle>{m.reviewedTitle}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form id={formId} noValidate className="grid gap-4" onSubmit={(e) => void submit(e)}>
            <p id={`${formId}-text`} className="text-[15px]">
              {m.reviewedText}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label={m.name}>
                <Input value={name} readOnly />
              </FormField>
              <FormField label={m.date}>
                <Input value={formatDate(today)} readOnly />
              </FormField>
            </div>
            <FormField label={m.designation} error={error}>
              <Input
                value={designation}
                maxLength={100}
                placeholder={m.designationPlaceholder}
                autoComplete="organization-title"
                // The one field to fill: name and date are given.
                autoFocus
                onChange={(event) => {
                  setDesignation(event.target.value);
                }}
              />
            </FormField>
            {failure ? (
              <Alert variant="destructive">
                <Icon icon={AlertCircleIcon} />
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {m.cancel}
          </Button>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy || undefined}>
            {busy ? <Spinner className="size-4" /> : null}
            {m.markReviewed}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What a refused or failed "Mark reviewed" means for the supervisor. */
function reviewFailure(outcome: Extract<FormMResult<null>, { ok: false }>): string {
  const { error } = outcome;
  if (error.kind !== 'problem') return m.reviewedFailed;
  switch (refusalOf(error.problem)) {
    case 'forbidden':
    case 'step-up-required':
      return m.reviewedForbidden;
    case 'compiling':
      return m.reviewedCompiling;
    case 'already-submitted':
      return m.reviewedSubmitted;
    case 'not-found':
      return m.reviewedNotFound;
    case 'invalid':
      return m.reviewedInvalid;
    // Not sent by this endpoint (no Idempotency-Key); as a failure to try again if it were.
    case 'busy':
      return m.reviewedFailed;
    case 'not-reviewed':
    case 'incomplete':
    case 'key-reused':
      return m.reviewedRefused;
  }
}

function Consequence({ icon, children }: { icon: IconProps['icon']; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon icon={icon} className="mt-0.5 size-4 flex-none" />
      <span>{children}</span>
    </li>
  );
}

/**
 * "Confirm and submit Form M" after the step-up (spec 09 FE-2): what confirming does, a late
 * warning past 31 July, and "I confirm the information is correct", which enables the button.
 * While submitting the dialog cannot be closed; a failed submit keeps it open to try again.
 */
export function ConfirmDialog({
  state,
  fyLabel,
  name,
  reviewer,
  today,
  dueDate,
  onChecked,
  onSubmit,
  onClose,
}: {
  state: Extract<ConfirmState, { step: 'confirm' | 'submitting' }>;
  /** "FY 2025/2026". */
  fyLabel: string;
  /** The commission-admin confirming. */
  name: string;
  /** The supervisor who reviewed the draft. */
  reviewer: string | null;
  today: string;
  dueDate: string;
  onChecked: (checked: boolean) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const textId = useId();
  const busy = state.step === 'submitting';
  const checked = busy || state.checked;
  const failed = state.step === 'confirm' && state.failed;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent busy={busy} aria-describedby={textId}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile>
            <Icon icon={SentIcon} />
          </IconTile>
          <DialogTitle>{m.confirmTitle}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p id={textId} className="text-[15px]">
            {m.confirmText(fyLabel)}
          </p>
          <ul className="grid gap-2 text-sm text-secondary-foreground">
            <Consequence icon={SquareLock02Icon}>{m.consequences.frozen}</Consequence>
            <Consequence icon={HashtagIcon}>{m.consequences.reference}</Consequence>
            <Consequence icon={UserIcon}>
              {m.consequences.confirmedBy(name, formatDate(today))}
            </Consequence>
            <Consequence icon={Notification03Icon}>{m.consequences.notified(reviewer)}</Consequence>
          </ul>
          {today > dueDate ? (
            <Alert variant="warning" role={undefined}>
              <Icon icon={Clock01Icon} />
              <AlertDescription>{m.lateWarning(formatDate(dueDate))}</AlertDescription>
            </Alert>
          ) : null}
          {failed ? (
            <Alert variant={failed === 'busy' ? 'warning' : 'destructive'}>
              <Icon icon={AlertCircleIcon} />
              <AlertDescription>
                {failed === 'busy' ? m.confirmBusy : m.confirmFailed}
              </AlertDescription>
            </Alert>
          ) : null}
          <CheckboxItem
            label={m.confirmCheckbox}
            checked={checked}
            disabled={busy}
            onChange={(event) => {
              onChecked(event.target.checked);
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {m.cancel}
          </Button>
          <Button
            type="button"
            disabled={busy || !checked}
            aria-busy={busy || undefined}
            onClick={onSubmit}
          >
            {busy ? (
              <>
                <Spinner className="size-4" />
                {m.submitting}
              </>
            ) : failed ? (
              m.tryAgain
            ) : (
              m.confirmAndSubmit
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A banner that takes focus when it appears, so the officer hears why nothing was submitted. */
function FocusedBanner({
  variant,
  title,
  text,
  action,
}: {
  variant: 'destructive' | 'warning';
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <Alert
      ref={ref}
      variant={variant}
      tabIndex={-1}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 outline-none"
    >
      <Icon icon={AlertCircleIcon} />
      <AlertDescription className="min-w-0 flex-1">
        <b className="font-semibold">{title}</b>
        {text ? <div>{text}</div> : null}
      </AlertDescription>
      {action ? <div className="ml-auto">{action}</div> : null}
    </Alert>
  );
}

/** The step-up failed or expired: nothing was submitted; "Confirm identity" starts over. */
export function StepUpFailedBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <FocusedBanner
      variant="destructive"
      title={m.stepUpFailedTitle}
      text={m.stepUpFailedText}
      action={
        <Button type="button" size="sm" onClick={onRetry}>
          <Icon icon={SecurityCheckIcon} />
          {m.confirmIdentity}
        </Button>
      }
    />
  );
}

const PART_I_PATHS = {
  'partI.contactDetails': m.partIFields.contactDetails,
  'partI.physicalAddress': m.partIFields.physicalAddress,
  'partI.emailAddress': m.partIFields.emailAddress,
} as Record<string, string>;

/** Why the service did not take the confirmation, with the way to the part to fix. */
export function RefusedBanner({
  reason,
  paths = [],
}: {
  reason: ConfirmRefusal;
  paths?: readonly string[];
}) {
  if (reason !== 'incomplete') {
    const copy = m.refused[reason];
    return (
      <FocusedBanner
        variant={reason === 'already-submitted' ? 'warning' : 'destructive'}
        title={copy.title}
        text={copy.text}
      />
    );
  }
  const partI = paths.flatMap((path) => PART_I_PATHS[path] ?? []);
  const partB = paths.some((path) => path.startsWith('partII.complaints'));
  const goTo = partI.length > 0 || !partB ? 'partI' : 'complaints';
  return (
    <FocusedBanner
      variant="destructive"
      title={m.refused.incomplete.title}
      text={m.incompleteText(partI, partB)}
      action={
        <Button asChild variant="secondary" size="sm">
          <a href={`#${FORM_M_ANCHORS[goTo]}`}>{goTo === 'partI' ? m.goToPartI : m.goToPartB}</a>
        </Button>
      }
    />
  );
}
