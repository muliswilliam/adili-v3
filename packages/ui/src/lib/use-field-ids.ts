import { type ReactNode, useId } from 'react';

/** Space-separated ids for aria-describedby, or undefined when there are none. */
export function describedBy(...ids: (string | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}

export interface FieldIdsOptions {
  /** Id for the control or group; generated when omitted. */
  id?: string | undefined;
  hint?: ReactNode;
  error?: ReactNode;
  /** The caller's own aria-describedby, kept ahead of the hint and error ids. */
  ownDescribedBy?: string | undefined;
}

/**
 * Ids that wire a control (or group) to its hint and error, so every field in the kit links
 * them the same way. The caller's own aria-describedby is merged in, never replaced.
 */
export function useFieldIds({ id, hint, error, ownDescribedBy }: FieldIdsOptions) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return {
    id: fieldId,
    hintId,
    errorId,
    describedBy: describedBy(ownDescribedBy, hintId, errorId),
  };
}
