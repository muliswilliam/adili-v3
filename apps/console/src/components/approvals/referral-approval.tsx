import { ApprovalCard, Button, Icon, type IconProps } from '@adili/ui';
import {
  Calendar03Icon,
  Cancel01Icon,
  Flag02Icon,
  LinkSquare02Icon,
  Mail01Icon,
  Message01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import type { ReferralSummary } from '../../approvals/kinds';
import { type DecisionRefusal, referralRefusalProblem } from '../../referral/refusals';
import { NARRATIVE_EXCERPT } from '../../referral/view';
import type { DecisionResult } from '../../server/referrals.server';
import type { Referral } from '../../server/review/types';
import type { ServiceError } from '../../server/service-call';
import type { FailureText } from '../dialog-parts';
import { GroundsBadge } from '../referrals/badges';
import {
  ApproveReferralDialog,
  DeclineReferralDialog,
  type ReferralSubject,
} from '../referrals/decision-dialogs';
import { messages as referrals } from '../referrals/messages';
import { useReferralDecisions } from '../referrals/use-referral-decisions';
import { decisionNotice, proposerName, ReassignActions, type RefusedCopy } from './approval-parts';
import type { ApprovalNotice, InboxKindView, ItemOf, KindApprovalProps } from './kind';
import { messages as inbox } from './messages';
import { messages as t } from './referral-messages';

export type ReferralApprovalItem = ItemOf<'referral'>;

/** What a referral rests on, by count, as the card lists it (none of a kind left out). */
function evidenceCounts(
  evidence: ReferralSummary['evidence'],
): { icon: IconProps['icon']; label: string }[] {
  return [
    { icon: Flag02Icon, count: evidence.flags, label: t.evidence.flags },
    { icon: Message01Icon, count: evidence.clarifications, label: t.evidence.clarifications },
    { icon: Calendar03Icon, count: evidence.obligations, label: t.evidence.obligations },
    // The ladder's issued steps (actions) go in as their letters.
    { icon: Mail01Icon, count: evidence.actions, label: t.evidence.actionLetters },
  ].flatMap(({ icon, count, label }) => (count > 0 ? [{ icon, label: label(count) }] : []));
}

/**
 * The narrative's start, with an ellipsis where review cut it. The excerpt is never longer than
 * `NARRATIVE_EXCERPT`, and the summary does not say whether it was cut, so one exactly that long
 * reads as cut.
 */
function excerpt(text: string): string {
  return text.length >= NARRATIVE_EXCERPT ? `${text.trimEnd()}…` : text;
}

function subjectOf(item: ReferralApprovalItem): ReferralSubject {
  return {
    id: item.subjectId,
    declarantName: item.summary.declarantName,
    grounds: item.summary.grounds,
    // The inbox counts the sources, not the package's items.
    evidenceItems: null,
  };
}

/**
 * A proposed referral to EACC in the approvals inbox (spec 08 FE-3, FE-6; S13, S14): the
 * declarant, the grounds, the file number and cycle, who proposed it (or the system) and how long
 * it has waited, the narrative's start and what it rests on, and Approve and Decline when the
 * viewer may decide it; else why not. Reassign and Open referral either way. It owns its approve
 * and decline dialogs and their calls.
 */
export function ReferralApproval({
  item,
  viewer,
  now,
  onReassign,
  onSettled,
  newKey,
}: KindApprovalProps<ReferralApprovalItem>) {
  const { summary } = item;
  const [dialog, setDialog] = useState<'approve' | 'decline' | null>(null);
  const decisions = useReferralDecisions(item.subjectId, newKey);
  const evidence = evidenceCounts(summary.evidence);

  /** Settles a call: a refusal or a decision made first becomes a notice. */
  async function settle(
    result: DecisionResult,
    success: (data: Referral) => string,
    refusedCopy: RefusedCopy,
  ): Promise<FailureText | null> {
    if (result.ok) {
      setDialog(null);
      await onSettled({ kind: 'decided', toast: success(result.data) });
      return null;
    }
    if (result.refusal) {
      setDialog(null);
      await onSettled({ kind: 'notice', notice: referralNoticeOf(result.refusal, refusedCopy) });
      return null;
    }
    return failureOf(result.error);
  }

  async function approve(): Promise<FailureText | null> {
    return settle(
      await decisions.approve(),
      (data) => referrals.toasts.approved(data.reference),
      t.refused,
    );
  }

  async function decline(_: ReferralSubject, note: string): Promise<FailureText | null> {
    return settle(await decisions.decline(note), () => referrals.toasts.declined, t.declineRefused);
  }

  return (
    <>
      <ApprovalCard
        kind="referral"
        icon={Flag02Icon}
        tone="brand"
        title={summary.declarantName}
        badge={<GroundsBadge grounds={summary.grounds} />}
        details={[
          ...(summary.personnelFileNumber ? [t.file(summary.personnelFileNumber)] : []),
          t.cycle(summary.cycleYear),
        ]}
        proposer={proposerName(item)}
        proposedAt={item.proposedAt}
        now={now}
        summary={
          <div className="grid gap-2">
            <p className="whitespace-pre-line">{excerpt(summary.narrativeExcerpt)}</p>
            {evidence.length > 0 ? (
              <ul
                aria-label={t.evidence.label}
                className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground"
              >
                {evidence.map((each) => (
                  <li key={each.label} className="inline-flex items-center gap-1.5">
                    <Icon icon={each.icon} className="size-3.5" />
                    {each.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        }
        canApprove={item.canApprove}
        cannotApproveReason={item.cannotApproveReason}
        cannotApproveText={item.cannotApproveReason === 'role' ? t.refused.role : undefined}
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
            <Link to="/referrals/$referralId" params={{ referralId: item.subjectId }}>
              <Icon icon={LinkSquare02Icon} />
              {t.openReferral}
            </Link>
          </Button>
        }
      />
      <ApproveReferralDialog
        subject={dialog === 'approve' ? subjectOf(item) : null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onConfirm={approve}
      />
      <DeclineReferralDialog
        subject={dialog === 'decline' ? subjectOf(item) : null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onConfirm={decline}
      />
    </>
  );
}

/** What a refusal of approve or decline means for the supervisor (403, 409), in its words. */
export function referralNoticeOf(refusal: DecisionRefusal, copy: RefusedCopy): ApprovalNotice {
  return decisionNotice(refusal, referralRefusalProblem(refusal), copy);
}

/** A failed call, in the open dialog. */
function failureOf(error: ServiceError): FailureText {
  return {
    title: error.kind === 'unauthenticated' ? inbox.toasts.sessionEnded : inbox.toasts.failed,
  };
}

/** The referrals tab (spec 08 FE-3). */
export const referralKind: InboxKindView<'referral'> = {
  label: t.tab,
  icon: Flag02Icon,
  subject: (item) => `${item.summary.declarantName} · ${referrals.grounds[item.summary.grounds]}`,
  Approval: ReferralApproval,
};
