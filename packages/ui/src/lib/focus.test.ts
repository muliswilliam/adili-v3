// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

import { focusRing } from './focus';

const require = createRequire(import.meta.url);
const tailwindDir = path.dirname(require.resolve('tailwindcss/package.json'));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

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

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`));
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
      await compileClasses('outline-hidden focus-visible:outline-2'),
    );

    expect(focused).not.toMatch(/--tw-outline-style:\s*solid/);
  });

  it('is used by every class string that hides the outline and shows one on focus', async () => {
    const roots = [path.join(repoRoot, 'packages/ui/src')];
    for (const app of await readdir(path.join(repoRoot, 'apps'))) {
      roots.push(path.join(repoRoot, 'apps', app, 'src'));
    }
    const offenders: string[] = [];
    for (const root of roots) {
      const files = await sourceFiles(root).catch(() => []);
      for (const file of files) {
        if (file === fileURLToPath(import.meta.url)) continue;
        for (const literal of (await readFile(file, 'utf8')).match(/(['"`])[^'"`]*\1/g) ?? []) {
          const hides = /(^|\s|['"`])outline-(none|hidden)(\s|['"`])/.test(literal);
          const shows = /focus-visible:outline-\d/.test(literal);
          const solid = literal.includes('focus-visible:outline-solid');
          if (hides && shows && !solid)
            offenders.push(`${path.relative(repoRoot, file)}: ${literal}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
