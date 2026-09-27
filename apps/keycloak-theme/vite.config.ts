import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { keycloakify } from 'keycloakify/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 3040, strictPort: true },
  plugins: [
    tailwindcss(),
    react(),
    keycloakify({
      themeName: 'adili',
      accountThemeImplementation: 'none',
      environmentVariables: [
        // Where staff and declarants sign in, read from Keycloak's environment at runtime. An
        // expired emailed link's page has no client to take them from, and must never take
        // them from the link itself.
        { name: 'ADILI_CONSOLE_URL', default: 'http://localhost:3020' },
        { name: 'ADILI_PORTAL_URL', default: 'http://localhost:3010' },
      ],
    }),
  ],
});
