// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

import { focusRing } from './focus';

const require = createRequire(import.meta.url);
const tailwindDir = path.dirname(require.resolve('tailwindcss/package.json'));

/** Compiles the given classes with Tailwind's utilities, as an app build would. */
async function compileClasses(classes: string): Promise<string> {
  const compiler = await compile(
    `@import 'tailwindcss/utilities'; @theme { --color-ring: #000; }`,
    {
      base: tailwindDir,
      loadStylesheet: async (id) => {
        const file = path.join(tailwindDir, `${id.replace(/^tailwindcss\//, '')}.css`);
        return { path: file, base: tailwindDir, content: await readFile(file, 'utf8') };
      },
    },
  );
  return compiler.build(classes.split(/\s+/));
}

/** The declarations of every rule that applies while focus is visible. */
function focusVisibleDeclarations(css: string): string {
  return Array.from(css.matchAll(/^[^{}\n]*:focus-visible\s*\{([^}]*)\}/gm), (match) => match[1])
    .filter((body): body is string => body !== undefined)
    .join('\n');
}

describe('focusRing', () => {
  it('compiles to a solid outline while focus is visible', async () => {
    const focused = focusVisibleDeclarations(await compileClasses(focusRing));

    // In Tailwind 4, outline-none and outline-hidden set --tw-outline-style to none, and
    // outline-2 reads its style from that variable, so the ring must set the style itself.
    expect(focused).toMatch(/--tw-outline-style:\s*solid/);
    expect(focused).toMatch(/outline-width:\s*2px/);
    expect(focused).toMatch(/outline-color:\s*var\(--color-ring\)/);
  });

  it('guards a real trap: outline-hidden with outline-2 alone draws no ring', async () => {
    const focused = focusVisibleDeclarations(
      // eslint-disable-next-line adili/focus-ring -- the broken recipe the lint rule catches
      await compileClasses('outline-hidden focus-visible:outline-2'),
    );

    expect(focused).not.toMatch(/--tw-outline-style:\s*solid/);
  });
});
