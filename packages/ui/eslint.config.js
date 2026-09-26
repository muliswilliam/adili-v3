import { reactConfig } from '@adili/eslint-config/react';

// prototype/ is a static, throwaway HTML design prototype, not part of the package.
export default [{ ignores: ['prototype/**'] }, ...reactConfig(import.meta.dirname)];
