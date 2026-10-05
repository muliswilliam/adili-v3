import { reactConfig } from '@adili/eslint-config/react';

export default [
  ...reactConfig(import.meta.dirname),
  // Generated from the contracts by `pnpm generate`.
  { ignores: ['src/server/*/schema.gen.ts', 'src/declaration/form.gen.ts'] },
  {
    // The declarations mock, loaded only through `declarations/mock.server.ts`.
    files: ['src/server/declarations/mock/**'],
    rules: { 'adili/no-client-server-imports': 'off' },
  },
];
