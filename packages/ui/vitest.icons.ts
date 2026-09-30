import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { Plugin } from 'vite';

const IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]@hugeicons\/core-free-icons['"];?/g;
const EXPORT = /export \{([^}]+)\} from '\.\/([^']+)'/g;

/**
 * Test-only Vite plugin: rewrites `import { Tick02Icon } from '@hugeicons/core-free-icons'` into
 * imports of the one-icon files, so a test loads the few icons it renders.
 *
 * Why: the package entry re-exports about 6,000 one-icon files (its CommonJS entry is a single
 * 7 MB file), and Vitest loads it again for every test file. On a busy machine that import alone
 * took tens of seconds per file and timed out the first render test in a file. Builds do not
 * need this: the bundler tree-shakes the entry.
 */
export function hugeiconsPerIcon(): Plugin {
  const require = createRequire(import.meta.url);
  const esm = join(dirname(require.resolve('@hugeicons/core-free-icons')), '..', 'esm');
  const files = new Map<string, string>();
  for (const [, names = '', file = ''] of readFileSync(join(esm, 'index.js'), 'utf8').matchAll(
    EXPORT,
  )) {
    for (const name of names.split(',')) files.set(name.trim().replace(/^default as /, ''), file);
  }

  return {
    name: 'adili:hugeicons-per-icon',
    enforce: 'pre',
    transform(code) {
      if (!code.includes('@hugeicons/core-free-icons')) return null;
      // One line per rewritten import, so stack traces keep their line numbers.
      return code.replace(IMPORT, (_, specifiers: string) =>
        specifiers
          .split(',')
          .map((specifier) => specifier.trim())
          .filter((specifier) => specifier.length > 0 && !specifier.startsWith('type '))
          .map((specifier) => {
            const [imported = '', local = imported] = specifier.split(/\s+as\s+/);
            const file = files.get(imported);
            if (!file) throw new Error(`Unknown Hugeicons icon: ${imported}`);
            return `import ${local} from ${JSON.stringify(join(esm, file))};`;
          })
          .join(' '),
      );
    },
  };
}
