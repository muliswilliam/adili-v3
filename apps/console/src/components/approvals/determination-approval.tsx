import {
  ApprovalCard,
  type ApprovalConsequence,
  ApprovalConsequences,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  FieldError,
  FieldHint,
  Icon,
  Label,
  OutcomeBadge,
  Spinner,
  Textarea,
} from '@adili/ui';
import {
  Archive02Icon,
  ArrowDataTransferHorizontalIcon,
  ArrowTurnBackwardIcon,
  File01Icon,
  HashtagIcon,
  JusticeScale01Icon,
  LinkSquare02Icon,
  Notification01Icon,
  StampIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';

import type { InboxItem } from '../../server/approvals.server';
import type { Assignee } from '../../server/review/types';
import { DialogFailure, DialogHeading, type FailureText } from '../determination/dialog-parts';
import { messages as t } from './messages';

export type DeterminationApprovalItem = Extract<InboxItem, { kind: 'determination' }>;

const RETURN_MAX_LENGTH = 2000;

/** What approving a determination does, in text before the approver decides (S1). */
export function determinationConsequences(item: DeterminationApprovalItem): ApprovalConsequence[] {
  const further = item.summary.outcome === 'further-action';
  return [
    { icon: HashtagIcon, title: t.approveDialog.cmp, detail: t.approveDialog.cmpDetail },
    { icon: File01Icon, title: t.approveDialog.letter, detail: t.approveDialog.letterDetail },
    {
      icon: Notification01Icon,
      title: t.approveDialog.notified(item.summary.declarantName),
      detail: t.approveDialog.notifiedDetail,
    },
    {
      icon: Archive02Icon,
      title: further ? t.approveDialog.furtherOpen : t.approveDialog.closed,
    },
  ];
}

/**
 * A proposed determination in the approvals inbox (spec 08 FE-3, S1, S14): the declarant, the
 * outcome, the case reference and file number, who proposed it and how long it has waited, the
 * reasons, and Approve and Return when the viewer may decide it; else why not. Reassign and
 * Open case either way.
 */
export function DeterminationApproval({
  item,
  viewer,
  now,
  onApprove,
  onReturn,
  onReassign,
}: {
  item: DeterminationApprovalItem;
  viewer: Assignee;
  /** The server's clock when the inbox loaded, for how long it has waited. */
  now: number;
  onApprove: () => void;
  onReturn: () => void;
  onReassign: () => void;
}) {
  const { summary } = item;
  const reassigned = item.reassignedTo;
  return (
    <ApprovalCard
      kind="determination"
      icon={JusticeScale01Icon}
      title={summary.declarantName}
      badge={<OutcomeBadge outcome={summary.outcome} />}
      details={[
        <span key="reference" className="font-mono whitespace-nowrap">
          {summary.caseReference}
        </span>,
        ...(summary.personnelFileNumber ? [summary.personnelFileNumber] : []),
      ]}
      proposer={item.proposer?.name ?? t.system}
      proposedAt={item.proposedAt}
      now={now}
      summary={<p className="whitespace-pre-line">{summary.reasonsExcerpt}</p>}
      canApprove={item.canApprove}
      cannotApproveReason={item.cannotApproveReason}
      decision={
        <>
          <Button size="sm" onClick={onApprove}>
            <Icon icon={Tick02Icon} />
            {t.approve}
          </Button>
          <Button size="sm" variant="secondary" onClick={onReturn}>
            <Icon icon={ArrowTurnBackwardIcon} />
            {t.return}
          </Button>
        </>
      }
      actions={
        <>
          {item.canApprove ? null : (
            <Button size="sm" variant="secondary" onClick={onReassign}>
              <Icon icon={ArrowDataTransferHorizontalIcon} />
              {t.reassign}
            </Button>
          )}
          {reassigned ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Icon icon={ArrowDataTransferHorizontalIcon} className="size-3.5" />
              {reassigned.subject === viewer.subject
                ? t.reassignedToYou
                : t.reassignedTo(reassigned.name)}
            </span>
          ) : null}
        </>
      }
      link={
        <Button asChild size="sm" variant="ghost">
          <Link to="/review/cases/$caseId/determination" params={{ caseId: summary.caseId }}>
            <Icon icon={LinkSquare02Icon} />
            {t.openCase}
          </Link>
        </Button>
      }
    />
  );
}

/** Approve a determination, its consequences stated first (spec 08 FE-3, a11y). */
export function ApproveDeterminationDialog({
  item,
  onOpenChange,
  onConfirm,
}: {
  item: DeterminationApprovalItem | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves to a failure to show in the dialog, or null once handled (the dialog closes). */
  onConfirm: (item: DeterminationApprovalItem) => Promise<FailureText | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FailureText | null>(null);
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) setFailure(null);
        onOpenChange(open);
      }}
    >
      {item ? (
        <DialogContent busy={busy} className="sm:max-w-[560px]">
          <DialogHeading
            icon={StampIcon}
            tone="success"
            title={t.approveDialog.title}
            description={`${item.summary.caseReference} · ${item.summary.declarantName}`}
          />
          <DialogBody className="gap-4">
            <DialogFailure failure={failure} />
            <div className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
              <OutcomeBadge outcome={item.summary.outcome} />
              {t.approveDialog.proposedBy(item.proposer?.name ?? t.system, item.proposedAt)}
            </div>
            <div className="grid gap-1.5 rounded-lg bg-muted px-3.5 py-3 text-sm text-secondary-foreground">
              <div className="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                {t.approveDialog.reasons}
              </div>
              <p className="whitespace-pre-line">{item.summary.reasonsExcerpt}</p>
            </div>
            <ApprovalConsequences
              items={determinationConsequences(item)}
              heading={t.approveDialog.consequences}
              headingLevel={3}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t.approveDialog.cancel}</Button>
            </DialogClose>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFailure(null);
                void onConfirm(item).then((failed) => {
                  setBusy(false);
                  setFailure(failed);
                });
              }}
            >
              {busy ? <Spinner /> : <Icon icon={Tick02Icon} />}
              {t.approveDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/** What is wrong with a return reason, or null. */
export function returnReasonError(reason: string): string | null {
  if (!reason.trim()) return t.returnDialog.required;
  if (reason.length > RETURN_MAX_LENGTH) return t.returnDialog.tooLong;
  return null;
}

/** Return a determination to its proposer, with a reason (required, up to 2,000; S2). */
export function ReturnDeterminationDialog({
  item,
  onOpenChange,
  onConfirm,
}: {
  item: DeterminationApprovalItem | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (item: DeterminationApprovalItem, reason: string) => Promise<FailureText | null>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<FailureText | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const proposer = item?.proposer?.name ?? t.system;
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReason('');
          setError(null);
          setFailure(null);
        }
        onOpenChange(open);
      }}
    >
      {item ? (
        <DialogContent busy={busy} className="sm:max-w-[560px]">
          <DialogHeading
            icon={ArrowTurnBackwardIcon}
            title={t.returnDialog.title}
            description={t.returnDialog.subject(item.summary.caseReference, proposer)}
          />
          <form
            noValidate
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              setFailure(null);
              const problem = returnReasonError(reason);
              setError(problem);
              if (problem) return;
              setBusy(true);
              void onConfirm(item, reason.trim()).then((failed) => {
                setBusy(false);
                setFailure(failed);
              });
            }}
          >
            <DialogBody className="gap-4">
              <DialogFailure failure={failure} />
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-reason`}>{t.returnDialog.reason}</Label>
                <Textarea
                  id={`${id}-reason`}
                  rows={4}
                  value={reason}
                  placeholder={t.returnDialog.placeholder}
                  disabled={busy}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={`${id}-reason-help`}
                  onChange={(event) => {
                    setReason(event.target.value);
                    if (error) setError(null);
                  }}
                />
                <div className="flex items-start justify-between gap-3">
                  {error ? (
                    <FieldError id={`${id}-reason-help`}>{error}</FieldError>
                  ) : (
                    <FieldHint id={`${id}-reason-help`}>{t.returnDialog.hint(proposer)}</FieldHint>
                  )}
                  <span
                    className={
                      reason.length > RETURN_MAX_LENGTH
                        ? 'text-[12.5px] text-destructive'
                        : 'text-[12.5px] text-muted-foreground'
                    }
                  >
                    {reason.length.toLocaleString('en-KE')} /{' '}
                    {RETURN_MAX_LENGTH.toLocaleString('en-KE')}
                  </span>
                </div>
              </div>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  {t.returnDialog.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {busy ? <Spinner /> : null}
                {t.returnDialog.confirm}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
