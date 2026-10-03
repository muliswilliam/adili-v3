import { useNavigate } from '@tanstack/react-router';
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

/**
 * Arriving with `?field=` (an Ask Adili answer's link, spec 11), focuses the element `find`
 * returns once the screen has rendered it, in the middle of the screen, then takes the field out
 * of the address so the same link works again. `find` runs after the render; without an element
 * the screen's heading is focused, so the declarant still lands on the section.
 */
export function useFocusLinkedField(field: string | undefined, find: () => HTMLElement | null) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!field) return;
    const target = find() ?? document.querySelector<HTMLElement>('main h1');
    if (target) {
      if (target.matches('h1')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
      // jsdom has no scrollIntoView.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
      target.scrollIntoView?.({ block: 'center' });
    }
    void navigate({
      to: '.',
      search: (previous: Record<string, unknown>) => ({ ...previous, field: undefined }),
      replace: true,
    } as never);
    // Only when a link arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);
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
