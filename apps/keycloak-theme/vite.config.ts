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
        // Where staff sign in once activated. Read from Keycloak's environment at runtime; the
        // links of expired or used activation links lead here, never to an address in the link.
        { name: 'ADILI_CONSOLE_URL', default: 'http://localhost:3020' },
      ],
    }),
  ],
});
