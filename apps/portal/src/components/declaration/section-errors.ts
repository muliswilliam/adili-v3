import { useCallback, useEffect, useState } from 'react';

/**
 * When a section screen shows its errors, shared by the bio, household, statement and other
 * sections: a field's error shows once the declarant has left it (touched), or all at once
 * when they arrive from the summary's "fix" links (`showErrors`), which also focuses the first
 * field to fix.
 */

/** Keys (a field, a path, `item:field`) the declarant has left, and whether each shows its error. */
export function useShownErrors(showErrors: boolean) {
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const touch = useCallback((key: string) => {
    setTouched((current) => (current.has(key) ? current : new Set([...current, key])));
  }, []);
  const shown = (key: string) => showErrors || touched.has(key);
  return { touch, shown };
}

const CONTROLS = 'input, textarea, select, button, [role="combobox"]';

/**
 * Focuses the element with this id when it is a control; when it is a group (a fieldset, a
 * card), its first invalid control, else its first control.
 */
export function focusControl(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const target = element.matches(CONTROLS)
    ? element
    : (element.querySelector<HTMLElement>(`[aria-invalid="true"]:is(${CONTROLS})`) ??
      element.querySelector<HTMLElement>(CONTROLS));
  target?.focus();
}

/**
 * Arriving with every error shown, focuses the first field to fix once. `firstId` is read then,
 * after the screen has rendered, and returns the element id to focus (null when nothing to fix).
 */
export function useFocusFirstError(showErrors: boolean, firstId: () => string | null) {
  useEffect(() => {
    if (!showErrors) return;
    const id = firstId();
    if (id) focusControl(id);
    // Only when arriving with errors shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showErrors]);
}

/** Reads a JSON pointer (`/registrableInterests/dualCitizenship/holds`) in `value`. */
function at(value: unknown, pointer: string): unknown {
  let node = value;
  for (const raw of pointer.split('/').slice(1)) {
    if (node === null || typeof node !== 'object') return undefined;
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** Whether `a` and `b` hold the same value at `pointer` (compared as JSON). */
export function sameAt(a: unknown, b: unknown, pointer: string): boolean {
  return JSON.stringify(at(a, pointer)) === JSON.stringify(at(b, pointer));
}
