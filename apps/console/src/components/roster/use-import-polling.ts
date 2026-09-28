import { useEffect, useEffectEvent, useState } from 'react';

import type { DirectoryResult, RosterImport } from '../../server/directory/client';
import { IMPORT_POLL_MS, importEnded } from './import-progress';

/** Consecutive failed polls before the step says it lost contact (it keeps trying). */
export const RECONNECTING_AFTER = 3;

export interface ImportPolling {
  /** The import as last read; null until the first answer. */
  imp: RosterImport | null;
  /**
   * `not-found`: the import is not the viewer's (404 or 403); polling stops.
   * `unavailable`: the first read failed; `retry` tries again.
   */
  error: 'not-found' | 'unavailable' | null;
  /** Several polls in a row failed after a good one; polling goes on. */
  reconnecting: boolean;
  retry: () => void;
}

export interface ImportPollingOptions {
  /** Reads the import; a server function in the app, a fake in tests. */
  read: (importId: string) => Promise<DirectoryResult<RosterImport>>;
  /** The session ended: sign in again. */
  onUnauthenticated: () => void;
  /** The import completed or failed. Called once per import. */
  onEnded: (imp: RosterImport) => void;
  intervalMs?: number;
}

/**
 * Reads the import now, then every 2 seconds until it completes or fails. Polls are sequential
 * (the next is scheduled when one answers), so a slow directory is never asked twice at once.
 * Pass `importId: null` to stop.
 */
export function useImportPolling(
  importId: string | null,
  { read, onUnauthenticated, onEnded, intervalMs = IMPORT_POLL_MS }: ImportPollingOptions,
): ImportPolling {
  const [round, setRound] = useState(0);
  // What polling found, for the import and round it was found in; anything else is stale and
  // reads as nothing yet, so switching imports or retrying needs no reset.
  const key = importId ? `${importId}:${String(round)}` : null;
  const [found, setFound] = useState<{
    key: string;
    imp: RosterImport | null;
    error: ImportPolling['error'];
    failures: number;
  } | null>(null);
  const current = found?.key === key ? found : null;
  // The latest callbacks, so a re-render with new closures does not restart polling.
  const readImport = useEffectEvent((id: string) => read(id));
  const unauthenticated = useEffectEvent(() => {
    onUnauthenticated();
  });
  const ended = useEffectEvent((done: RosterImport) => {
    onEnded(done);
  });

  useEffect(() => {
    if (!importId || !key) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seen = false;
    let failed = 0;

    const poll = async () => {
      const result = await readImport(importId).catch((): DirectoryResult<RosterImport> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }));
      if (stopped) return;
      if (result.ok) {
        seen = true;
        failed = 0;
        setFound({ key, imp: result.data, error: null, failures: 0 });
        if (importEnded(result.data)) {
          ended(result.data);
          return;
        }
      } else if (result.error.kind === 'unauthenticated') {
        unauthenticated();
        return;
      } else if (
        result.error.kind === 'problem' &&
        (result.error.problem.status === 404 || result.error.problem.status === 403)
      ) {
        setFound({ key, imp: null, error: 'not-found', failures: 0 });
        return;
      } else if (!seen) {
        setFound({ key, imp: null, error: 'unavailable', failures: 1 });
        return;
      } else {
        failed += 1;
        const failures = failed;
        setFound((last) => ({ key, imp: last?.imp ?? null, error: null, failures }));
      }
      timer = setTimeout(() => void poll(), intervalMs);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [importId, key, intervalMs]);

  return {
    imp: current?.imp ?? null,
    error: current?.error ?? null,
    reconnecting: (current?.failures ?? 0) >= RECONNECTING_AFTER,
    retry: () => {
      setRound((current) => current + 1);
    },
  };
}
