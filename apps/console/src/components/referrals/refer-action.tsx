import { Button, Icon, useToast } from '@adili/ui';
import { Flag02Icon } from '@hugeicons/core-free-icons';
import { useRef } from 'react';

import { referableClarifications, referableFlags, referralOffered } from '../../referral/view';
import { proposeCaseReferral } from '../../server/referrals';
import { referralRefusalProblem } from '../../referral/refusals';
import type { CaseView } from '../../server/review-case.server';
import type { Referral, ReferralInput } from '../../server/review/types';
import type { FailureText } from '../dialog-parts';
import { messages as t } from './messages';
import { ReferDialog } from './refer-dialog';

/**
 * "Refer to EACC" on a case (spec 08 FE-6, S13): for the case's assignee while the case is not
 * determined and has a registry or comparison flag to rest on (`referralOffered`). The page holds
 * the dialog open, as the propose dialog's Start referral opens it too (#610), and says what
 * follows a proposal.
 */
export function ReferAction({
  load,
  open,
  onOpenChange,
  onProposed,
  newKey = () => crypto.randomUUID(),
}: {
  load: CaseView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the toast: open the referral, or go back to where the dialog was opened from. */
  onProposed: (referral: Referral) => void;
  /** A fresh Idempotency-Key per dialog; tests fix it. */
  newKey?: () => string;
}) {
  const { detail, viewer } = load;
  const item = detail.case;
  const { toast } = useToast();
  const idempotencyKey = useRef<string | null>(null);
  if (!referralOffered(item, detail.flags, viewer)) return null;

  async function propose(input: ReferralInput): Promise<FailureText | null> {
    idempotencyKey.current ??= newKey();
    const result = await proposeCaseReferral({
      data: { caseId: item.id, input, idempotencyKey: idempotencyKey.current },
    });
    // A refusal is an answer: the next try is a new request. A failure may not have been.
    if (result.ok || result.refusal) idempotencyKey.current = null;
    if (!result.ok) {
      if (result.refusal) {
        const { kind } = result.refusal;
        const text: { title: string; detail?: string } = t.refusals[kind];
        return { ...text, problem: referralRefusalProblem(result.refusal) };
      }
      return {
        title: result.error.kind === 'unauthenticated' ? t.toasts.sessionEnded : t.toasts.failed,
      };
    }
    toast({ title: t.refer.proposed });
    onProposed(result.data);
    return null;
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          onOpenChange(true);
        }}
      >
        <Icon icon={Flag02Icon} />
        {t.refer.open}
      </Button>
      <ReferDialog
        open={open}
        onOpenChange={onOpenChange}
        subject={`${item.reference} · ${item.declarantName}`}
        flags={referableFlags(detail.flags)}
        clarifications={referableClarifications(detail.clarifications)}
        onSubmit={propose}
      />
    </>
  );
}
