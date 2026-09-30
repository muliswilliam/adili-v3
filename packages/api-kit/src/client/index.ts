/**
 * `@adili/api-kit/client`: framework-free helpers for calling a service over HTTP, for the apps'
 * servers as well as the services (no Nest or Fastify imports).
 */
export { type RequestTimeout, type SendRequest, withDeadline } from './deadline.js';
export { type MockableClientOptions, type MockFetch, mockableClient } from './mockable-client.js';
export { clientIp } from './client-ip.js';
export { STEP_UP_ACR, STEP_UP_WINDOW_SECONDS } from '../auth/step-up.js';
