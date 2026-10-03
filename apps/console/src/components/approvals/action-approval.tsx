import { ApprovalCard, Badge, Button, Icon, useIdempotencyKey } from '@adili/ui';
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
import { useCallback, useEffect, useState } from 'react';

import { isGraveStep, subjectOf } from '../../actions/ladder';
import { decisionRefusal, REFUSAL_PROBLEM } from '../../actions/refusal';
import type { ActionStep, AdministrativeAction } from '../../server/actions.server';
import { approveLadderStep, declineLadderStep, getLadder } from '../../server/actions';
import type { ServiceResult } from '../../server/service-call';
import { en as a, stepLabel } from '../actions/messages';
import { type EarlierSteps, stepsBefore } from '../actions/prior-steps';
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
          ) : prior.step === 'notice-to-comply' || prior.step === 'warning' ? (
            // Only a notice or a warning takes a response.
            <span>{t.noResponse}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The steps before a grave step (salary stoppage, disciplinary referral), read from its ladder
 * while its approve dialog is open, so the supervisor reads every response and the stoppage's
 * payroll acknowledgement in full before deciding (#208, US 13); the card's summary has excerpts
 * only. Undefined for a notice or warning, or while the dialog is closed.
 */
function useEarlierSteps(item: ActionApprovalItem, open: boolean): EarlierSteps | undefined {
  const { ladderId, step } = item.summary;
  const wanted = open && isGraveStep(step);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  // What the last read answered, for the read it was (`key`); any other read is still loading.
  const key = `${ladderId}:${String(attempt)}`;
  const [answered, setAnswered] = useState<{ key: string; earlier: EarlierSteps } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void getLadder({ data: { ladderId } })
      .catch(() => ({ ok: false }) as const)
      .then((result) => {
        if (!live) return;
        setAnswered({
          key,
          earlier: result.ok
            ? { state: 'ok', steps: stepsBefore(result.data, item.subjectId) }
            : { state: 'failed', retry },
        });
      });
    return () => {
      live = false;
    };
  }, [wanted, key, ladderId, item.subjectId, retry]);
  if (!wanted) return undefined;
  return answered?.key === key ? answered.earlier : { state: 'loading' };
}

/**
 * A drafted step of an administrative action ladder in the approvals inbox (spec 08 FE-3, FE-5; S5, S9,
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
}: KindApprovalProps<ActionApprovalItem>) {
  const { summary } = item;
  const subject = subjectOf(summary);
  const [dialog, setDialog] = useState<'approve' | 'decline' | null>(null);
  // One key per decision, reused on retry after a failure, so a retry cannot act twice.
  // As the Actions view: one key per decision body, kept across retries, dropped once answered.
  const approvalKey = useIdempotencyKey();
  const declineKey = useIdempotencyKey();
  const nowIso = new Date(now).toISOString();
  const earlier = useEarlierSteps(item, dialog === 'approve');

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
    const result = await approveLadderStep({
      data: { actionId: item.subjectId, idempotencyKey: approvalKey.keyFor(item.subjectId) },
    });
    if (result.ok || noticeOf(result.error)) approvalKey.reset();
    return settle(result, (data) => t.toasts.approved(data.step, data.reference));
  }

  async function decline(note: string): Promise<FailureText | null> {
    const result = await declineLadderStep({
      data: {
        actionId: item.subjectId,
        note,
        idempotencyKey: declineKey.keyFor({ id: item.subjectId, note }),
      },
    });
    if (result.ok || noticeOf(result.error)) declineKey.reset();
    return settle(result, (data) => t.toasts.declined(data.step));
  }

  return (
    <>
      <ApprovalCard
        kind="action"
        icon={STEP_ICONS[summary.step]}
        tone={isGraveStep(summary.step) ? 'destructive' : 'default'}
        title={summary.declarantName}
        badge={
          <Badge variant={isGraveStep(summary.step) ? 'destructive' : 'warning'}>
            {stepLabel(summary.step)}
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
        consequences={consequencesOf(
          summary.step,
          summary.declarantName,
          nowIso,
          summary.personnelFileNumber,
        )}
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
              {summary.step === 'salary-stoppage' ? t.approveStoppage : t.approve}
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
        personnelFileNumber={summary.personnelFileNumber}
        now={nowIso}
        {...(earlier ? { earlier } : {})}
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
  if (refusal === null || refusal === 'not-declined') return null;
  const failure = { title: a.refusals[refusal], problem: REFUSAL_PROBLEM[refusal] };
  if (refusal === 'not-proposed') {
    return { title: t.decided.title, failure, after: t.decided.after, offerReassign: false };
  }
  return {
    title: t.refused.title,
    failure,
    after: refusal === 'role' ? t.refused.roleAfter : t.refused.separationAfter,
    // Another supervisor can take a separation-of-duties refusal.
    offerReassign: refusal !== 'role',
  };
}

/** The actions tab (spec 08 FE-3): drafted ladder steps. */
export const actionKind: InboxKindView<'action'> = {
  label: t.tab,
  icon: Legal01Icon,
  subject: (item) => `${stepLabel(item.summary.step)} · ${item.summary.declarantName}`,
  Approval: ActionApproval,
};
