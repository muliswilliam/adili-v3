/**
 * `@adili/api-kit/client`: framework-free helpers for calling a service over HTTP, for the apps'
 * servers as well as the services (no Nest or Fastify imports).
 */
export { type RequestTimeout, type SendRequest, withDeadline } from './deadline.js';
export { type MockableClientOptions, type MockFetch, mockableClient } from './mockable-client.js';
