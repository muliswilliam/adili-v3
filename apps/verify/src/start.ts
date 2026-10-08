import { createMiddleware, createStart } from '@tanstack/react-start';

import {
  createNonce,
  frameAncestorsFrom,
  isHttps,
  securityHeaders,
} from './server/security-headers';

/** Strict headers on every response, with a CSP nonce the router puts on its scripts. */
const securityHeadersMiddleware = createMiddleware().server(async ({ request, next }) => {
  const nonce = createNonce();
  const result = await next({ context: { nonce } });
  const headers = securityHeaders({
    nonce,
    dev: import.meta.env.DEV,
    https: isHttps(request),
    frameAncestors: frameAncestorsFrom(process.env.DEMO_FRAME_ANCESTORS),
  });
  headers.forEach((value, name) => {
    result.response.headers.set(name, value);
  });
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware],
}));
