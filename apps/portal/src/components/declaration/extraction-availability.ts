import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether "Read into the form" is on for a draft's Commission. The contract gives the declarant
 * no AI status (contract gap 2), so the portal learns it when it asks: a
 * `document` set with that status. It is remembered for the draft in memory, for this visit.
 */

const off = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function markExtractionOff(declarationId: string) {
  if (off.has(declarationId)) return;
  off.add(declarationId);
  for (const listener of listeners) listener();
}

/** Forgets what was learnt (tests). */
export function resetExtractionAvailability() {
  off.clear();
  for (const listener of listeners) listener();
}

/** False once the draft's Commission is known not to read documents. */
export function useExtractionEnabled(declarationId: string): boolean {
  const snapshot = useCallback(() => !off.has(declarationId), [declarationId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
