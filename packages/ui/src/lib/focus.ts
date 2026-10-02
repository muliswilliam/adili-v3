/**
 * The kit's keyboard focus ring: a 2px ink outline 2px outside the element, shown only for
 * keyboard focus. Compose it with `cn` to change the colour or offset.
 *
 * `outline-hidden` hides the browser's default ring (and keeps a transparent one in forced
 * colours mode). In Tailwind 4 both it and `outline-none` set `--tw-outline-style: none`, and
 * `outline-2` reads its style from that variable, so `focus-visible:outline-solid` is needed or
 * the ring never draws.
 */
export const focusRing =
  'outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * `focusRing` drawn 2px inside the element, for controls whose outer edge is clipped or covered:
 * tabs in a scrolling list, a button inside a field.
 */
export const focusRingInset = `${focusRing} focus-visible:-outline-offset-2`;

/**
 * `focusRing` on an element for keyboard focus inside it: a label whose visually hidden radio or
 * checkbox has focus.
 */
export const focusRingWithin =
  'has-focus-visible:outline-2 has-focus-visible:outline-solid has-focus-visible:outline-offset-2 has-focus-visible:outline-ring';

/**
 * An inline text link: ink text with a light underline that darkens on hover, a 6px radius for
 * the ring and `focusRing`. For links in running text; elsewhere use `Button variant="link"`.
 */
export const textLink = `${focusRing} rounded-sm text-foreground underline decoration-input underline-offset-3 hover:decoration-foreground`;
