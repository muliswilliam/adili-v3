import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  IconTile,
  Spinner,
} from '@adili/ui';
import { AlertCircleIcon, InformationCircleIcon, Undo02Icon } from '@hugeicons/core-free-icons';
import { useRef, useState } from 'react';

import { REQUEST_COPY as COPY } from '../../access/copy';
import type { WithdrawResult } from '../../server/access-requests.server';
import type { Unauthenticated } from '../../server/results';
import { signInAgain } from '../sign-in';

export type Withdraw = (idempotencyKey: string) => Promise<WithdrawResult | Unauthenticated>;

type Phase = 'confirm' | 'busy' | 'unavailable' | 'decided' | 'closed';

/**
 * Confirms withdrawing a request, then withdraws it once (one key per confirmation, reused on
 * retry). When the Commission decided or closed it meanwhile (409), says so instead; either way
 * the page reloads the request when the dialog closes.
 */
export function WithdrawDialog({
  open,
  reference,
  commission,
  withdraw,
  onWithdrawn,
  onClose,
}: {
  open: boolean;
  reference: string;
  commission: string;
  withdraw: Withdraw;
  onWithdrawn: () => void;
  /** `changed` when the request moved on meanwhile, so the page should reload it. */
  onClose: (changed: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const key = useRef<string | null>(null);

  function close() {
    const changed = phase === 'decided' || phase === 'closed';
    setPhase('confirm');
    key.current = null;
    onClose(changed);
  }

  async function confirm() {
    key.current ??= crypto.randomUUID();
    setPhase('busy');
    try {
      const result = await withdraw(key.current);
      switch (result.status) {
        case 'withdrawn':
          setPhase('confirm');
          key.current = null;
          onWithdrawn();
          return;
        case 'conflict':
          setPhase(result.reason);
          return;
        case 'unauthenticated':
          signInAgain();
          return;
        default:
          setPhase('unavailable');
      }
    } catch {
      setPhase('unavailable');
    }
  }

  const conflict = phase === 'decided' || phase === 'closed';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && phase !== 'busy') close();
      }}
    >
      <DialogContent>
        {conflict ? (
          <>
            <DialogHeader className="flex-row items-center gap-3">
              <IconTile tone="info">
                <Icon icon={InformationCircleIcon} />
              </IconTile>
              <DialogTitle>
                {phase === 'decided' ? COPY.decidedTitle : COPY.closedTitle}
              </DialogTitle>
            </DialogHeader>
            <DialogBody>
              <DialogDescription className="text-[15px] text-foreground">
                {phase === 'decided' ? COPY.decidedText(commission) : COPY.closedText}
              </DialogDescription>
            </DialogBody>
            <DialogFooter>
              <Button type="button" onClick={close}>
                {COPY.seeRequest}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="flex-row items-center gap-3">
              <IconTile tone="destructive">
                <Icon icon={Undo02Icon} />
              </IconTile>
              <DialogTitle>{COPY.withdrawTitle}</DialogTitle>
            </DialogHeader>
            <DialogBody className="grid gap-3">
              <DialogDescription className="text-[15px] text-foreground">
                {COPY.withdrawStops(commission)}{' '}
                <span className="font-mono font-semibold whitespace-nowrap">{reference}</span>{' '}
                {COPY.withdrawCloses}
              </DialogDescription>
              <p className="text-[13.5px] text-muted-foreground">{COPY.withdrawAgain}</p>
              {phase === 'unavailable' ? (
                <Alert variant="destructive">
                  <Icon icon={AlertCircleIcon} />
                  <AlertDescription>{COPY.withdrawUnavailable}</AlertDescription>
                </Alert>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={phase === 'busy'} onClick={close}>
                {COPY.cancel}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={phase === 'busy'}
                aria-busy={phase === 'busy' || undefined}
                onClick={() => void confirm()}
              >
                {phase === 'busy' ? <Spinner /> : null}
                {phase === 'busy' ? COPY.withdrawing : COPY.withdraw}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
