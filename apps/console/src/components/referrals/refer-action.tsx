import { Button, Icon, useToast } from '@adili/ui';
import { Flag02Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { referableClarifications, referableFlags } from '../../referral/view';
import { proposeCaseReferral } from '../../server/referrals';
import { REFERRAL_REFUSAL_STATUS } from '../../server/referrals.server';
import type { CaseView } from '../../server/review-case.server';
import type { ReferralInput } from '../../server/review/types';
import type { FailureText } from '../dialog-parts';
import { messages as t } from './messages';
import { ReferDialog } from './refer-dialog';

/**
 * "Refer to EACC" on a case (spec 08 FE-6, S13): for the case's assignee while the case is not
 * determined and has a registry or comparison flag to rest on. Proposing opens the referral.
 */
export function ReferAction({
  load,
  newKey = () => crypto.randomUUID(),
}: {
  load: CaseView;
  /** A fresh Idempotency-Key per dialog; tests fix it. */
  newKey?: () => string;
}) {
  const { detail, viewer } = load;
  const item = detail.case;
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const flags = referableFlags(detail.flags);
  const offered =
    item.assignee?.subject === viewer.subject && item.status !== 'determined' && flags.length > 0;
  if (!offered) return null;

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
        return { ...text, problem: `${String(REFERRAL_REFUSAL_STATUS[kind])} ${kind}` };
      }
      return {
        title: result.error.kind === 'unauthenticated' ? t.toasts.sessionEnded : t.toasts.failed,
      };
    }
    setOpen(false);
    toast({ title: t.refer.proposed });
    void router.navigate({ to: '/referrals/$referralId', params: { referralId: result.data.id } });
    return null;
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon icon={Flag02Icon} />
        {t.refer.open}
      </Button>
      <ReferDialog
        open={open}
        onOpenChange={setOpen}
        subject={`${item.reference} · ${item.declarantName}`}
        flags={flags}
        clarifications={referableClarifications(detail.clarifications)}
        onSubmit={propose}
      />
    </>
  );
}
