import { reactConfig } from '@adili/eslint-config/react';

export default [
  ...reactConfig(import.meta.dirname),
  // Generated from the directory and declarations contracts by `pnpm generate`.
  { ignores: ['src/server/directory/schema.gen.ts', 'src/server/declarations/schema.gen.ts'] },
];
