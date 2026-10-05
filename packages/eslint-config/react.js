import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { focusRingPlugin } from './focus-ring.js';
import { serverImportsPlugin } from './server-imports.js';

/**
 * Type-aware lint rules shared by the TanStack Start apps and the UI package.
 * @param {string} tsconfigRootDir directory of the package's tsconfig.json
 */
export function reactConfig(tsconfigRootDir) {
  return tseslint.config(
    // `prototype/` holds throwaway clickable HTML designs, not product code.
    { ignores: ['dist/**', '.output/**', '.tanstack/**', '**/*.gen.ts', 'prototype/**'] },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    reactHooks.configs.flat.recommended,
    {
      plugins: { adili: { rules: { ...focusRingPlugin.rules, ...serverImportsPlugin.rules } } },
      languageOptions: {
        globals: { ...globals.browser, ...globals.node },
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        // TanStack Router uses `throw redirect()` with non-Error objects.
        '@typescript-eslint/only-throw-error': 'off',
        // A visible keyboard focus ring (docs/design.md, Focus).
        'adili/focus-ring': 'error',
        // Runtime values from `.server` modules never reach the browser bundle.
        'adili/no-client-server-imports': 'error',
      },
    },
    {
      // Tests and their helpers run on Node, where `.server` modules load like any other.
      files: ['**/*.test.{ts,tsx}', '**/testing.{ts,tsx}', 'src/test/**'],
      rules: { 'adili/no-client-server-imports': 'off' },
    },
    {
      files: ['**/*.config.{js,ts,mjs}', 'eslint.config.js'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}
