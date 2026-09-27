import createClient from 'openapi-fetch';

import { env } from '../env.server';
import type { paths } from './schema.gen';

/** Deadline for every directory call (ADR-013: synchronous service calls time out after 2 s). */
export const DIRECTORY_TIMEOUT_MS = 2_000;

function headers(accessToken: string) {
  return { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
}

/** The global `fetch`, looked up per call, with the directory deadline. */
function send(request: Request): Promise<Response> {
  return fetch(new Request(request, { signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS) }));
}

/**
 * Typed client for the directory, generated from `packages/schemas/internal/directory.yaml`.
 * Calls carry the caller's access token so the directory applies their visibility.
 */
export function directoryClient(accessToken: string) {
  return createClient<paths>({
    baseUrl: env().DIRECTORY_API_URL,
    headers: headers(accessToken),
    fetch: send,
  });
}

export type DirectoryClient = ReturnType<typeof directoryClient>;

/**
 * `GET` on a directory endpoint the contract does not describe yet (`/v1/me`), with the same
 * base URL, token and deadline as the typed client.
 */
export function directoryGet(accessToken: string, path: `/${string}`): Promise<Response> {
  return send(
    new Request(new URL(path, env().DIRECTORY_API_URL), { headers: headers(accessToken) }),
  );
}
