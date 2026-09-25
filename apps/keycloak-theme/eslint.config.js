import { reactConfig } from '@adili/eslint-config/react';

export default [
  { ignores: ['src/kc.gen.tsx', 'dist_keycloak/**', 'public/keycloakify-dev-resources/**'] },
  ...reactConfig(import.meta.dirname),
];
