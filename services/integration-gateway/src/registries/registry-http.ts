import type { z } from 'zod';

import { callUpstream } from '../adapter-kit/upstream-http.js';

/**
 * GETs one registry resource and parses it with `schema` (`callUpstream`). Resolves to null on 404
 * when `notFound` is `null`. Messages name the registry, never the URL: it may carry a national ID.
 */
export function getFromRegistry<T>(
  registry: string,
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  options: { notFound?: null } = {},
): Promise<T | null> {
  return callUpstream({ name: registry, url, signal, ...options }, schema);
}

/** A path segment or query value, encoded. */
export const segment = (value: string) => encodeURIComponent(value);
