import { getGlobalStartContext } from '@tanstack/react-start';
import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Every lookup is recorded and rate limited, so nothing is loaded before it is asked for.
    defaultPreload: false,
    // The request's CSP nonce (start.ts), on the scripts the server renders.
    ssr: { nonce: getGlobalStartContext()?.nonce },
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
