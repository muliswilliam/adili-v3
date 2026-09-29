/**
 * Guards the kit's focus ring (docs/design.md, Focus row). In Tailwind 4, `outline-none` and
 * `outline-hidden` set `--tw-outline-style: none`, and `outline-2` reads its style from that
 * variable, so a class string that hides the outline and sets an outline width on focus draws no
 * ring unless it also sets `outline-solid` under the same variants. Hand-written rings should
 * compose `focusRing` from `@adili/ui` with `cn`, and never use `outline-none`.
 *
 * Limits: each string literal is checked on its own, so a ring split across `cn()` arguments
 * (`cn('outline-none', 'focus-visible:outline-2')`) is not caught, and every string is checked,
 * not only class names. A ring is checked against the outline hidden on the same element, so
 * `[&_a]:outline-none` goes with `[&_a]:focus-visible:outline-2` and not with an unprefixed ring.
 * Only `focus-visible`, `after` and `before` are ignored when matching; any other variant, such
 * as `hover:` or `group-hover:`, counts as a separate element, so `outline-none` with
 * `hover:focus-visible:outline-2` is not caught.
 */

/** A variant-prefixed outline or ring width, e.g. `focus-visible:after:outline-2`. */
const WIDTH = /^(-?outline|ring)(-(\d+(\.\d+)?|\[[^\]]+\]))?$/;
const STYLE = /^outline-(solid|dashed|dotted|double)$/;

/** Splits a class into its variants and utility, e.g. `focus-visible:after:outline-2`. */
function parse(token) {
  const parts = token.replace(/^!/, '').split(':');
  const utility = (parts.pop() ?? '').replace(/!$/, '');
  return { variants: parts, utility };
}

/** Variants that say when or on which pseudo-element the ring draws, not which element it is on. */
const NOT_SCOPE = new Set(['focus-visible', 'after', 'before']);

/**
 * The element a class applies to, as its remaining variants: `''` for the element itself,
 * `[&_a]` for its child links.
 */
function scopeOf(variants) {
  return variants.filter((variant) => !NOT_SCOPE.has(variant)).join(':');
}

/**
 * What is wrong with a class string's focus ring, if anything: a list of messages, empty when
 * the string is fine.
 * @param {string} text
 * @returns {string[]}
 */
export function focusRingProblems(text) {
  const tokens = text.split(/\s+/).filter(Boolean).map(parse);

  /** How each element's outline is hidden: `outline-none` wins over `outline-hidden`. */
  const hidden = new Map();
  for (const { variants, utility } of tokens) {
    if (variants.includes('focus-visible')) continue;
    if (utility !== 'outline-none' && utility !== 'outline-hidden') continue;
    const scope = scopeOf(variants);
    if (hidden.get(scope) !== 'outline-none') hidden.set(scope, utility);
  }
  if (hidden.size === 0) return [];

  const onFocus = tokens.filter((t) => t.variants.includes('focus-visible'));
  const widths = onFocus.filter((t) => WIDTH.test(t.utility) && t.utility !== 'ring-inset');
  const styled = new Set(
    onFocus.filter((t) => STYLE.test(t.utility)).map((t) => t.variants.join(':')),
  );

  const problems = [];
  const reported = new Set();
  for (const { variants, utility } of widths) {
    const scope = scopeOf(variants);
    const hides = hidden.get(scope);
    if (!hides) continue;
    if (hides === 'outline-none' && !reported.has(scope)) {
      reported.add(scope);
      problems.push(
        '`outline-none` with a focus ring: compose `focusRing` from @adili/ui with `cn`, or use `outline-hidden` (docs/design.md, Focus).',
      );
    }
    if (!utility.includes('outline')) continue;
    const key = variants.join(':');
    if (!styled.has(key)) {
      problems.push(
        `\`${key}:${utility}\` without \`${key}:outline-solid\` draws no ring once the outline is hidden: compose \`focusRing\` from @adili/ui with \`cn\`.`,
      );
    }
  }
  return problems;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Class strings that hide the outline must draw a visible focus ring.' },
    schema: [],
  },
  create(context) {
    const check = (node, text) => {
      for (const message of focusRingProblems(text)) context.report({ node, message });
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export const focusRingPlugin = { rules: { 'focus-ring': rule } };
