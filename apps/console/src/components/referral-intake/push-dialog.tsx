import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  Icon,
  ReferenceChip,
  Spinner,
} from '@adili/ui';
import { SentIcon } from '@hugeicons/core-free-icons';
import { useState } from 'react';

import type { ReferralIntakeItem } from '../../server/reporting/types';
import { DialogFailure, DialogHeading, type FailureText } from '../dialog-parts';
import { Fact } from '../referrals/fact';
import { messages as t } from './messages';
import { pushAction } from './icms-status';

/**
 * Push a referral to ICMS (spec 09 FE-5): what ICMS receives, then the push, which waits for the
 * case number. A failed referral's dialog is the retry. Resolves to a failure to show in the
 * dialog, or null once handled.
 */
export function PushDialog({
  referral,
  onOpenChange,
  onConfirm,
}: {
  /** The referral to push; null when closed. */
  referral: ReferralIntakeItem | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (referral: ReferralIntakeItem) => Promise<FailureText | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FailureText | null>(null);
  const retry = referral?.icmsStatus === 'push-failed';
  const action = referral ? pushAction(referral) : null;
  return (
    <Dialog
      open={referral !== null}
      onOpenChange={(open) => {
        if (!open) setFailure(null);
        onOpenChange(open);
      }}
    >
      {referral ? (
        <DialogContent busy={busy} className="sm:max-w-[560px]">
          <DialogHeading
            icon={SentIcon}
            title={retry ? t.pushDialog.retryTitle : t.pushDialog.title}
          />
          <DialogBody className="gap-4">
            <DialogFailure failure={failure} />
            {busy ? (
              <div role="status" className="grid justify-items-center gap-2 py-6 text-center">
                <Spinner className="size-7" />
                <p className="font-medium">{t.pushDialog.sending}</p>
                <p className="text-sm text-muted-foreground">{t.pushDialog.sendingDetail}</p>
              </div>
            ) : (
              <>
                <p className="text-[15px]">{t.pushDialog.body}</p>
                <section
                  aria-labelledby="icms-receives"
                  className="rounded-xl px-4 py-3.5 ring-1 ring-border"
                >
                  <h3
                    id="icms-receives"
                    className="mb-2 text-[13.5px] font-medium text-muted-foreground"
                  >
                    {t.pushDialog.receives}
                  </h3>
                  <dl className="grid gap-x-4 gap-y-3 text-[15px] min-[480px]:grid-cols-2">
                    <Fact term={t.pushDialog.referral}>
                      <ReferenceChip reference={referral.reference} size="sm" />
                    </Fact>
                    <Fact term={t.pushDialog.commission}>{referral.commission.name}</Fact>
                    <Fact term={t.pushDialog.grounds}>{t.grounds[referral.grounds]}</Fact>
                    <Fact term={t.pushDialog.declarant}>
                      <span className="font-normal">{t.pushDialog.declarantValue}</span>
                    </Fact>
                  </dl>
                </section>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={busy}>
                {t.pushDialog.cancel}
              </Button>
            </DialogClose>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFailure(null);
                void onConfirm(referral).then((failed) => {
                  setBusy(false);
                  setFailure(failed);
                });
              }}
            >
              <Icon icon={action?.icon ?? SentIcon} />
              {action?.label ?? t.pushDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
