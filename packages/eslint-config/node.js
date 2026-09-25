import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Type-aware lint rules shared by every NestJS service and Node library.
 * @param {string} tsconfigRootDir directory of the package's tsconfig.json
 */
export function nodeConfig(tsconfigRootDir) {
  return tseslint.config(
    { ignores: ['dist/**', 'coverage/**', 'migrations/**'] },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        // Nest modules and DI tokens are classes without members.
        '@typescript-eslint/no-extraneous-class': 'off',
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        // Nest resolves constructor dependencies by runtime type metadata.
        '@typescript-eslint/consistent-type-imports': 'off',
      },
    },
    {
      files: ['**/*.config.{js,ts,mjs}', 'eslint.config.js'],
      ...tseslint.configs.disableTypeChecked,
    },
    prettier,
  );
}
