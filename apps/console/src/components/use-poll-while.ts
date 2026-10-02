import { useRouter } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useState } from 'react';

export interface Poll {
  /** Reloads so far in this round. */
  polls: number;
  /** All `times` reloads were made and the page still waits: stop saying it will move on. */
  exhausted: boolean;
  /** Reloads now and starts another round, e.g. from a "Check again" button. */
  restart: () => void;
}

/**
 * While the page waits on a workflow (notifying the declarant, issuing a package or a certified
 * copy: seconds), reloads the route's data every `everyMs`, at most `times` times, so the page
 * moves on by itself without polling for as long as the tab stays open.
 */
export function usePollWhile(active: boolean, everyMs: number, times: number): Poll {
  const router = useRouter();
  const [round, setRound] = useState(0);
  const [polls, setPolls] = useState(0);
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    setPolls(0);
  }
  const reload = useEffectEvent(() => {
    void router.invalidate();
  });
  useEffect(() => {
    if (!active) return;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setPolls(count);
      if (count >= times) clearInterval(timer);
      reload();
    }, everyMs);
    return () => {
      clearInterval(timer);
    };
  }, [active, everyMs, times, round]);
  return {
    polls,
    exhausted: active && polls >= times,
    restart: () => {
      setPolls(0);
      setRound((current) => current + 1);
      void router.invalidate();
    },
  };
}
