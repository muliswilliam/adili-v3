import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig, type Rolldown } from 'vite';

/** Libraries mark modules "use client" for React Server Components; harmless without RSC. */
function ignoreUseClientDirectives(
  warning: Rolldown.RollupLog,
  warn: (warning: Rolldown.RollupLog) => void,
) {
  if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning);
}

const port = Number(process.env.PORT) || 3020;

export default defineConfig({
  server: { host: true, allowedHosts: true, port, strictPort: true },
  preview: { host: true, port, strictPort: true },
  resolve: { tsconfigPaths: true },
  build: { rolldownOptions: { onwarn: ignoreUseClientDirectives } },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({ rolldownConfig: { onwarn: ignoreUseClientDirectives } }),
    viteReact(),
  ],
});
