import { useEffect, useState } from 'react';

/** The longest delay setTimeout keeps (about 24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * The time a page reads a state off: the loader's `serverNow` (epoch milliseconds), so server and
 * browser render alike, until `at` passes in the browser, then the browser's time. A page whose
 * state turns at a known moment (a package not issued an hour after the grant reads as missing)
 * moves on then without a reload. A later `serverNow`, after a reload, wins.
 */
export function useNowAt(serverNow: number, at: number | null): number {
  const [woke, setWoke] = useState<number | null>(null);
  useEffect(() => {
    if (at === null || at <= serverNow) return;
    const timer = setTimeout(
      () => {
        // At least `at`, so a browser clock running behind the server's still turns the state.
        setWoke(Math.max(Date.now(), at));
      },
      Math.min(Math.max(0, at - Date.now()), MAX_TIMEOUT_MS),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [at, serverNow]);
  return Math.max(serverNow, woke ?? 0);
}
