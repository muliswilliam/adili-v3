import { useEffect, useRef } from 'react';

export interface PollOptions<T> {
  /** Polls while this is not null; a new key starts over with a fresh count. */
  pollKey: string | null;
  /** One read. A read that throws counts as a read that changed nothing. */
  read: () => Promise<T>;
  /** Handles a read; returns true when there is nothing left to wait for. */
  onRead: (value: T | null) => boolean;
  /** Called once `limit` reads went by without `onRead` saying done. */
  onGiveUp: () => void;
  /** Time before each read. */
  intervalMs: number;
  limit: number;
}

/**
 * Reads again every `intervalMs` while `pollKey` is set, up to `limit` reads, for the checks
 * that answer later (registry lookups, document reading), since the contract has no push. An
 * answer that arrives after the key changed or the component left is dropped. The callbacks are
 * read at call time, so they may change on every render.
 */
export function usePoll<T>({ pollKey, read, onRead, onGiveUp, intervalMs, limit }: PollOptions<T>) {
  const latest = useRef({ read, onRead, onGiveUp });
  useEffect(() => {
    latest.current = { read, onRead, onGiveUp };
  });

  useEffect(() => {
    if (pollKey === null) return;
    let stopped = false;
    let reads = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        void (async () => {
          reads += 1;
          const value = await latest.current.read().catch(() => null);
          if (stopped) return;
          if (latest.current.onRead(value)) return;
          if (reads >= limit) latest.current.onGiveUp();
          else next();
        })();
      }, intervalMs);
    };
    next();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pollKey, intervalMs, limit]);
}
