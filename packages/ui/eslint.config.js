import { reactConfig } from '@adili/eslint-config/react';

export default [
  // Static HTML prototypes (design reference, not shipped code).
  { ignores: ['prototype/**'] },
  ...reactConfig(import.meta.dirname),
];
