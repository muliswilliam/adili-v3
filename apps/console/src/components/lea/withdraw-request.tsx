import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Icon,
  IconTile,
  Spinner,
  useToast,
} from '@adili/ui';
import { Cancel01Icon, SquareLock02Icon, Undo02Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';

import type { AccessResult } from '../../server/access-requests.server';
import type { LeaRequest } from '../../server/access/types';
import { withdrawLea } from '../../server/lea-requests';
import { Consequences, Problem } from '../access/resolve-dialogs';
import { goToSignIn } from '../sign-in-redirect';
import { messages as m } from './messages';

/** What the withdrawal's answer means for the officer: done, gone stale, or try again. */
export type WithdrawOutcome =
  | { kind: 'withdrawn' }
  | { kind: 'sign-in' }
  | { kind: 'stale'; message: string }
  | { kind: 'retry'; message: string };

/**
 * Folds the access service's answer: 409 `request-decided` (the Commission decided first) and
 * `request-closed` (withdrawn already, e.g. in another tab) leave nothing to withdraw, as does a
 * 404; anything else can be tried again with the same Idempotency-Key.
 */
export function withdrawOutcome(result: AccessResult<LeaRequest>): WithdrawOutcome {
  if (result.ok) return { kind: 'withdrawn' };
  const { error } = result;
  if (error.kind === 'unauthenticated') return { kind: 'sign-in' };
  if (error.kind === 'problem') {
    const { status, code } = error.problem;
    if (status === 409 && code === 'request-decided') {
      return { kind: 'stale', message: m.withdrawDecided };
    }
    if (status === 409 || status === 404) return { kind: 'stale', message: m.withdrawClosed };
  }
  return { kind: 'retry', message: m.withdrawFailed };
}

/**
 * "Withdraw request" on one of the officer's open requests (user decision 5): a confirmation
 * first, as the withdrawal is final; then the request is closed, the Commission's access officers
 * are told, and the page reloads. One Idempotency-Key per opening of the dialog, kept across its
 * retries.
 */
export function WithdrawRequest({ request }: { request: LeaRequest }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await withdrawLea({
      data: { requestId: request.id, idempotencyKey: key },
    }).catch((): AccessResult<LeaRequest> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
    setBusy(false);
    const outcome = withdrawOutcome(result);
    switch (outcome.kind) {
      case 'withdrawn':
        setOpen(false);
        toast({ title: m.withdrawnToast(request.reference) });
        await router.invalidate();
        return;
      case 'sign-in':
        goToSignIn();
        return;
      case 'stale':
        setOpen(false);
        toast({ title: outcome.message, urgency: 'assertive' });
        await router.invalidate();
        return;
      case 'retry':
        setError(outcome.message);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) {
          setKey(crypto.randomUUID());
          setError(null);
        }
        setOpen(next);
      }}
    >
      <div className="-mx-5 -mb-1 flex items-center justify-between gap-3 border-t px-5 pt-3.5">
        <span className="text-[13.5px] text-muted-foreground">{m.withdrawHint}</span>
        <DialogTrigger asChild>
          <Button variant="destructive-ghost" size="sm" className="-mr-2.5">
            <Icon icon={Undo02Icon} />
            {m.withdraw}
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent busy={busy}>
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile tone="destructive">
            <Icon icon={Undo02Icon} />
          </IconTile>
          <DialogTitle>{m.withdrawTitle(request.reference)}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <DialogDescription className="text-sm text-secondary-foreground">
            {m.withdrawLead(request.commission.name)}
          </DialogDescription>
          <Consequences
            items={[
              { icon: Cancel01Icon, title: m.withdrawStops, text: m.withdrawStopsText },
              { icon: SquareLock02Icon, title: m.withdrawFinal, text: m.withdrawFinalText },
            ]}
          />
          <Problem error={error} />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setOpen(false);
            }}
          >
            {m.keepRequest}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void confirm()}
          >
            {busy ? <Spinner className="size-4" /> : null}
            {m.withdrawConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** When the officer withdrew the request (its `withdrawn` register entry); null if not. */
export function withdrawnAt(request: Pick<LeaRequest, 'timeline'>): string | null {
  return request.timeline.find((entry) => entry.kind === 'withdrawn')?.at ?? null;
}
