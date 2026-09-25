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
    }),
  ],
});
