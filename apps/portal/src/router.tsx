import { getGlobalStartContext } from '@tanstack/react-start';
import { createRouter } from '@tanstack/react-router';

import { RouteError, RouteNotFound } from './components/route-error';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // A route revisited after its data went stale waits for a fresh read rather than showing the
    // cached one: a section screen seeded from an old read would show, and save, old contents
    // (#700, #701).
    defaultStaleReloadMode: 'blocking',
    // A styled page, not TanStack's bare "Something went wrong!", when a route throws (#686).
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
    // The request's CSP nonce (start.ts), on the scripts the server renders.
    ssr: { nonce: getGlobalStartContext()?.nonce },
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
