import { useState } from 'react';

export interface PendingKey {
  /** The key to send: the pending one of this scope, else a new one. */
  keyFor: () => string;
  /** Whether this scope has a pending key. */
  pending: boolean;
  /** What was typed with the pending key (a withdrawal's reason); empty without one. */
  draft: string;
  /**
   * After an answer to a request sent with `key`: keep it (and `draft`) while `mayBeRecorded`
   * (no answer, or the first request with it still running), so the retry or the next attempt
   * replays it; otherwise drop it.
   */
  settle: (key: string, mayBeRecorded: boolean, draft?: string) => void;
}

/**
 * The Idempotency-Key of a release page action (publish, withdraw, Build v{n+1}) that may have
 * been recorded, as the releases list keeps its build's per year: null until then, then
 * `{ key, scope, draft }`, `scope` the release id. The page stays mounted when a Versions link
 * opens another release, and that release's action is another request, so it gets a new key
 * rather than one the service has seen with another body (422).
 */
export function usePendingKey(scope: string): PendingKey {
  const [stored, setStored] = useState<{ key: string; scope: string; draft: string } | null>(null);
  const mine = stored?.scope === scope ? stored : null;
  return {
    keyFor: () => mine?.key ?? crypto.randomUUID(),
    pending: mine !== null,
    draft: mine?.draft ?? '',
    settle: (key, mayBeRecorded, draft = '') => {
      setStored(mayBeRecorded ? { key, scope, draft } : null);
    },
  };
}
