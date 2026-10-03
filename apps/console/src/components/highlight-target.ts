/** How long the target of a link into the page stays highlighted. */
export const HIGHLIGHT_MS = 2_400;

/**
 * Scrolls to the element with `id` and highlights it (`data-target-highlight`, which `@adili/ui`
 * styles) for `HIGHLIGHT_MS`, focusing it without scrolling again: a Copilot source in the
 * declaration pane, a figure's row in the national report. Returns false when the page does not
 * have the element.
 */
export function highlightTarget(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.setAttribute('data-target-highlight', '');
  if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
  element.focus({ preventScroll: true });
  setTimeout(() => {
    element.removeAttribute('data-target-highlight');
  }, HIGHLIGHT_MS);
  return true;
}
