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
import { useId, useRef, useState } from 'react';

import { RETURN_REASON_MAX_LENGTH } from '../../determination/view';
import { approveCaseDetermination, returnCaseDetermination } from '../../server/determinations';
import {
  type DeterminationRefusal,
  type DeterminationResult,
  REFUSAL_STATUS,
} from '../../server/determinations.server';
import type { Determination } from '../../server/review/types';
import type { ServiceError } from '../../server/service-call';
import { DialogFailure, DialogHeading, type FailureText } from '../dialog-parts';
import { proposerName, ReassignActions } from './approval-parts';
import { messages as t } from './determination-messages';
import type { ApprovalNotice, InboxKindView, ItemOf, KindApprovalProps } from './kind';
import { messages as m } from './messages';

export type DeterminationApprovalItem = ItemOf<'determination'>;

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
 * Open case either way. It owns its approve and return dialogs and their calls.
 */
export function DeterminationApproval({
  item,
  viewer,
  now,
  onReassign,
  onSettled,
  newKey,
}: KindApprovalProps<DeterminationApprovalItem>) {
  const { summary } = item;
  const [dialog, setDialog] = useState<'approve' | 'return' | null>(null);
  // One key per approval, reused on retry after a failure, so a retry cannot approve twice.
  const approvalKey = useRef<string | null>(null);

  /** Settles a call: a refusal or a decision made first becomes a notice. */
  async function settle(
    result: DeterminationResult<Determination>,
    success: (data: Determination) => string,
  ): Promise<FailureText | null> {
    if (result.ok) {
      setDialog(null);
      await onSettled({ kind: 'decided', toast: success(result.data) });
      return null;
    }
    if (result.refusal) {
      setDialog(null);
      await onSettled({ kind: 'notice', notice: noticeOf(result.refusal) });
      return null;
    }
    return failureOf(result.error);
  }

  async function approve(): Promise<FailureText | null> {
    approvalKey.current ??= newKey();
    const result = await approveCaseDetermination({
      data: { determinationId: item.subjectId, idempotencyKey: approvalKey.current },
    });
    if (result.ok || result.refusal) approvalKey.current = null;
    return settle(result, (data) => t.toasts.approved(data.reference));
  }

  async function returnTo(reason: string): Promise<FailureText | null> {
    const result = await returnCaseDetermination({
      data: { determinationId: item.subjectId, reason },
    });
    return settle(result, () => t.toasts.returned);
  }

  return (
    <>
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
        proposer={proposerName(item)}
        proposedAt={item.proposedAt}
        now={now}
        summary={<p className="whitespace-pre-line">{summary.reasonsExcerpt}</p>}
        canApprove={item.canApprove}
        cannotApproveReason={item.cannotApproveReason}
        decision={
          <>
            <Button
              size="sm"
              onClick={() => {
                setDialog('approve');
              }}
            >
              <Icon icon={Tick02Icon} />
              {t.approve}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDialog('return');
              }}
            >
              <Icon icon={ArrowTurnBackwardIcon} />
              {t.return}
            </Button>
          </>
        }
        actions={<ReassignActions item={item} viewer={viewer} onReassign={onReassign} />}
        link={
          <Button asChild size="sm" variant="ghost">
            <Link to="/review/cases/$caseId/determination" params={{ caseId: summary.caseId }}>
              <Icon icon={LinkSquare02Icon} />
              {t.openCase}
            </Link>
          </Button>
        }
      />
      <ApproveDeterminationDialog
        item={dialog === 'approve' ? item : null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onConfirm={approve}
      />
      <ReturnDeterminationDialog
        item={dialog === 'return' ? item : null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onConfirm={returnTo}
      />
    </>
  );
}

/** What a refusal of approve or return means for the supervisor (403, 409). */
export function noticeOf(refusal: DeterminationRefusal): ApprovalNotice {
  const problem = `${String(REFUSAL_STATUS[refusal.kind])} ${refusal.kind}`;
  if (refusal.kind === 'separation-of-duties') {
    return {
      title: t.refused.title,
      failure: { title: t.refused[refusal.reason], problem },
      after: t.refused.separationAfter,
      offerReassign: true,
    };
  }
  if (refusal.kind === 'supervisor-required') {
    return {
      title: t.refused.title,
      failure: { title: t.refused.role, problem },
      after: t.refused.roleAfter,
      offerReassign: false,
    };
  }
  return {
    title: t.decided.title,
    failure: { title: t.decided.body, problem },
    after: t.decided.after,
    offerReassign: false,
  };
}

/** A failed call, in the open dialog. */
function failureOf(error: ServiceError): FailureText {
  return { title: error.kind === 'unauthenticated' ? m.toasts.sessionEnded : m.toasts.failed };
}

/** The determinations tab (spec 08 FE-3). */
export const determinationKind: InboxKindView<'determination'> = {
  label: t.tab,
  icon: JusticeScale01Icon,
  subject: (item) => `${item.summary.caseReference} · ${item.summary.declarantName}`,
  Approval: DeterminationApproval,
};

/** Approve a determination, its consequences stated first (spec 08 FE-3, a11y). */
export function ApproveDeterminationDialog({
  item,
  onOpenChange,
  onConfirm,
}: {
  item: DeterminationApprovalItem | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves to a failure to show in the dialog, or null once handled (the dialog closes). */
  onConfirm: () => Promise<FailureText | null>;
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
              {t.approveDialog.proposedBy(proposerName(item), item.proposedAt)}
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
                void onConfirm().then((failed) => {
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
  if (reason.length > RETURN_REASON_MAX_LENGTH) return t.returnDialog.tooLong;
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
  onConfirm: (reason: string) => Promise<FailureText | null>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<FailureText | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const proposer = item ? proposerName(item) : m.system;
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
              void onConfirm(reason.trim()).then((failed) => {
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
                      reason.length > RETURN_REASON_MAX_LENGTH
                        ? 'text-[12.5px] text-destructive'
                        : 'text-[12.5px] text-muted-foreground'
                    }
                  >
                    {reason.length.toLocaleString('en-KE')} /{' '}
                    {RETURN_REASON_MAX_LENGTH.toLocaleString('en-KE')}
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
