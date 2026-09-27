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
