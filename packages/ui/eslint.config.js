import { reactConfig } from '@adili/eslint-config/react';

export default [
  // Static clickable designs, not part of the package build.
  { ignores: ['prototype/**'] },
  ...reactConfig(import.meta.dirname),
];
