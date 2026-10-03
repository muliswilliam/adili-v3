import { ApprovalCard, Badge, Button, Icon } from '@adili/ui';
import {
  AlertCircleIcon,
  BanIcon,
  Cancel01Icon,
  Legal01Icon,
  LinkSquare02Icon,
  Notification01Icon,
  Tick02Icon,
  UserWarning01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { subjectOf } from '../../actions/ladder';
import { decisionRefusal } from '../../actions/refusal';
import type { ActionStep, AdministrativeAction } from '../../server/actions.server';
import { approveLadderStep, declineLadderStep } from '../../server/actions';
import type { ServiceResult } from '../../server/service-call';
import { STEP_LABELS } from '../actions/messages';
import { ApproveStepDialog, consequencesOf, DeclineStepDialog } from '../actions/step-dialogs';
import type { FailureText } from '../dialog-parts';
import { messages as t } from './action-messages';
import { proposerName, ReassignActions } from './approval-parts';
import type { ApprovalNotice, InboxKindView, ItemOf, KindApprovalProps } from './kind';
import { messages as m } from './messages';

export type ActionApprovalItem = ItemOf<'action'>;

const STEP_ICONS: Record<ActionStep, typeof Notification01Icon> = {
  'notice-to-comply': Notification01Icon,
  warning: AlertCircleIcon,
  'salary-stoppage': BanIcon,
  'disciplinary-referral': UserWarning01Icon,
};

const GRAVE: ReadonlySet<ActionStep> = new Set(['salary-stoppage', 'disciplinary-referral']);

/** The steps issued before this one, with the declarant's responses, read before deciding (S9). */
function PriorSteps({ item }: { item: ActionApprovalItem }) {
  const { priorSteps } = item.summary;
  if (priorSteps.length === 0) return <p>{t.firstStep}</p>;
  return (
    <ul className="grid gap-2">
      {priorSteps.map((prior) => (
        <li key={prior.actionId} className="grid gap-0.5">
          <span className="font-medium text-foreground">
            {t.prior(prior.step, prior.reference, prior.issuedAt)}
          </span>
          {prior.respondedAt ? (
            <span>
              {t.responded(prior.respondedAt, prior.responseAttachments)}{' '}
              <span className="whitespace-pre-line">{prior.responseExcerpt}</span>
            </span>
          ) : (
            <span>{t.noResponse}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A drafted step of an enforcement ladder in the approvals inbox (spec 08 FE-3, FE-5; S5, S9,
 * S14): the declarant, the step, what the ladder is about and the file number, who drafted it and
 * how long it has waited, the steps issued before it with any response, what approving does, and
 * Approve and Decline when the viewer may decide it; else why not. Reassign and Open ladder either
 * way. It owns its approve and decline dialogs (the Actions view's) and their calls.
 */
export function ActionApproval({
  item,
  viewer,
  now,
  onReassign,
  onSettled,
  newKey,
}: KindApprovalProps<ActionApprovalItem>) {
  const { summary } = item;
  const subject = subjectOf(summary);
  const [dialog, setDialog] = useState<'approve' | 'decline' | null>(null);
  // One key per decision, reused on retry after a failure, so a retry cannot act twice.
  const approvalKey = useRef<string | null>(null);
  const declineKey = useRef<{ note: string; key: string } | null>(null);
  const nowIso = new Date(now).toISOString();

  async function settle(
    result: ServiceResult<AdministrativeAction>,
    success: (data: AdministrativeAction) => string,
  ): Promise<FailureText | null> {
    if (result.ok) {
      setDialog(null);
      await onSettled({ kind: 'decided', toast: success(result.data) });
      return null;
    }
    const notice = noticeOf(result.error);
    if (notice) {
      setDialog(null);
      await onSettled({ kind: 'notice', notice });
      return null;
    }
    return {
      title: result.error.kind === 'unauthenticated' ? m.toasts.sessionEnded : m.toasts.failed,
    };
  }

  async function approve(): Promise<FailureText | null> {
    approvalKey.current ??= newKey();
    const result = await approveLadderStep({
      data: { actionId: item.subjectId, idempotencyKey: approvalKey.current },
    });
    if (result.ok || noticeOf(result.error)) approvalKey.current = null;
    return settle(result, (data) => t.toasts.approved(data.step, data.reference));
  }

  async function decline(note: string): Promise<FailureText | null> {
    if (declineKey.current?.note !== note) declineKey.current = { note, key: newKey() };
    const result = await declineLadderStep({
      data: { actionId: item.subjectId, note, idempotencyKey: declineKey.current.key },
    });
    if (result.ok || noticeOf(result.error)) declineKey.current = null;
    return settle(result, (data) => t.toasts.declined(data.step));
  }

  return (
    <>
      <ApprovalCard
        kind="action"
        icon={STEP_ICONS[summary.step]}
        tone={GRAVE.has(summary.step) ? 'destructive' : 'default'}
        title={summary.declarantName}
        badge={
          <Badge variant={GRAVE.has(summary.step) ? 'destructive' : 'warning'}>
            {STEP_LABELS[summary.step]}
          </Badge>
        }
        details={[
          <span
            key="subject"
            className={subject.reference ? 'font-mono whitespace-nowrap' : 'whitespace-nowrap'}
          >
            {subject.title}
          </span>,
          subject.cause,
          t.fileNumber(summary.personnelFileNumber),
        ]}
        proposer={proposerName(item)}
        proposedAt={item.proposedAt}
        now={now}
        summary={<PriorSteps item={item} />}
        consequences={consequencesOf(summary.step, summary.declarantName, nowIso)}
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
                setDialog('decline');
              }}
            >
              <Icon icon={Cancel01Icon} />
              {t.decline}
            </Button>
          </>
        }
        actions={<ReassignActions item={item} viewer={viewer} onReassign={onReassign} />}
        link={
          <Button asChild size="sm" variant="ghost">
            <Link to="/actions/$ladderId" params={{ ladderId: summary.ladderId }}>
              <Icon icon={LinkSquare02Icon} />
              {t.openLadder}
            </Link>
          </Button>
        }
      />
      <ApproveStepDialog
        open={dialog === 'approve'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        step={summary.step}
        declarantName={summary.declarantName}
        subjectTitle={subject.title}
        now={nowIso}
        onSubmit={approve}
      />
      <DeclineStepDialog
        open={dialog === 'decline'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        step={summary.step}
        declarantName={summary.declarantName}
        onSubmit={decline}
      />
    </>
  );
}

/** What a refusal of approve or decline means for the supervisor (403, 409); null otherwise. */
export function noticeOf(error: Parameters<typeof decisionRefusal>[0]): ApprovalNotice | null {
  const refusal = decisionRefusal(error);
  if (refusal === 'proposer' || refusal === 'reviewer-of-record') {
    return {
      title: t.refused.title,
      failure: { title: t.refused[refusal], problem: '403 separation-of-duties' },
      after: t.refused.separationAfter,
      offerReassign: true,
    };
  }
  if (refusal === 'role') {
    return {
      title: t.refused.title,
      failure: { title: t.refused.role, problem: '403 supervisor-required' },
      after: t.refused.roleAfter,
      offerReassign: false,
    };
  }
  if (refusal === 'not-proposed') {
    return {
      title: t.decided.title,
      failure: { title: t.decided.body, problem: '409 not-proposed' },
      after: t.decided.after,
      offerReassign: false,
    };
  }
  return null;
}

/** The actions tab (spec 08 FE-3): drafted ladder steps. */
export const actionKind: InboxKindView<'action'> = {
  label: t.tab,
  icon: Legal01Icon,
  subject: (item) => `${STEP_LABELS[item.summary.step]} · ${item.summary.declarantName}`,
  Approval: ActionApproval,
};
