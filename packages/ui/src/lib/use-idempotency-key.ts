import { useCallback, useMemo, useRef } from 'react';

/** The Idempotency-Key of a command, one per body (ADR-013 §7.5). */
export interface IdempotencyKeys {
  /**
   * The key to send with `body`: the same while the body is unchanged, so a retry after a
   * network failure is answered once; new when it changes, because the service keeps its first
   * answer (a refusal too) under a key and refuses the key with another body.
   */
  keyFor: (body: unknown) => string;
  /** Forgets the key, so the next command gets a new one even with the same body. */
  reset: () => void;
}

/**
 * One Idempotency-Key per command body, kept across retries. Bodies are compared by their JSON,
 * so pass a value built the same way each time (the object the command sends).
 */
export function useIdempotencyKey(): IdempotencyKeys {
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const keyFor = useCallback((body: unknown) => {
    const serialised = typeof body === 'string' ? body : JSON.stringify(body);
    if (attempt.current?.body !== serialised) {
      attempt.current = { key: crypto.randomUUID(), body: serialised };
    }
    return attempt.current.key;
  }, []);
  const reset = useCallback(() => {
    attempt.current = null;
  }, []);
  return useMemo(() => ({ keyFor, reset }), [keyFor, reset]);
}
