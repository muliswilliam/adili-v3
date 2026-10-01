import { useState } from 'react';

import { signInAgain } from './sign-in';

/** What a confirmed action came to: done, a problem to show in the dialog, or signed out. */
export type ConfirmOutcome<P> =
  { status: 'done' } | { status: 'problem'; problem: P } | { status: 'unauthenticated' };

export interface ConfirmAction<P> {
  open: boolean;
  /** Opens or closes the dialog; closing clears the problem. */
  setOpen: (open: boolean) => void;
  busy: boolean;
  problem: P | null;
  /** Runs the action: busy while it runs, closed when done, the problem kept otherwise. */
  run: () => Promise<void>;
}

/**
 * The state of a confirmation dialog whose confirm button calls the server (discard draft,
 * amend, discard amendment): open, busy while the call runs, the problem it came back with, and
 * sign-in again when the session is gone (staying busy while the page leaves). A call that
 * throws is `unavailable`.
 */
export function useConfirmAction<P>({
  action,
  unavailable,
}: {
  action: () => Promise<ConfirmOutcome<P>>;
  unavailable: P;
}): ConfirmAction<P> {
  const [open, setOpenState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<P | null>(null);

  function setOpen(next: boolean) {
    setOpenState(next);
    if (!next) setProblem(null);
  }

  async function run() {
    setBusy(true);
    setProblem(null);
    const outcome = await action().catch((): ConfirmOutcome<P> => ({
      status: 'problem',
      problem: unavailable,
    }));
    if (outcome.status === 'unauthenticated') {
      signInAgain();
      return;
    }
    setBusy(false);
    if (outcome.status === 'done') setOpenState(false);
    else setProblem(outcome.problem);
  }

  return { open, setOpen, busy, problem, run };
}
