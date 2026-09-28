/**
 * Guards the kit's focus ring (docs/design.md, Focus row). In Tailwind 4, `outline-none` and
 * `outline-hidden` set `--tw-outline-style: none`, and `outline-2` reads its style from that
 * variable, so a class string that hides the outline and sets an outline width on focus draws no
 * ring unless it also sets `outline-solid` under the same variants. Hand-written rings should
 * compose `focusRing` from `@adili/ui` with `cn`, and never use `outline-none`.
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

/**
 * What is wrong with a class string's focus ring, if anything: a list of messages, empty when
 * the string is fine.
 * @param {string} text
 * @returns {string[]}
 */
export function focusRingProblems(text) {
  const tokens = text.split(/\s+/).filter(Boolean).map(parse);
  const unprefixed = new Set(tokens.filter((t) => t.variants.length === 0).map((t) => t.utility));
  const hidesWithNone = unprefixed.has('outline-none');
  if (!hidesWithNone && !unprefixed.has('outline-hidden')) return [];

  const onFocus = tokens.filter((t) => t.variants.includes('focus-visible'));
  const widths = onFocus.filter((t) => WIDTH.test(t.utility) && t.utility !== 'ring-inset');
  const styled = new Set(
    onFocus.filter((t) => STYLE.test(t.utility)).map((t) => t.variants.join(':')),
  );

  const problems = [];
  if (hidesWithNone && widths.length > 0) {
    problems.push(
      '`outline-none` with a focus ring: compose `focusRing` from @adili/ui with `cn`, or use `outline-hidden` (docs/design.md, Focus).',
    );
  }
  for (const { variants, utility } of widths) {
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
