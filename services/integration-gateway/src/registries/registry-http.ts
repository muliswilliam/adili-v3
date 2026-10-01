import type { z } from 'zod';

import { UpstreamError } from '../adapter-kit/upstream-error.js';

/**
 * GETs one registry resource and parses it with `schema` (the external contract's shape, in
 * snake_case, transformed to ours). Resolves to null on 404 when `notFound` is `null`; a 429 is
 * an `UpstreamError` with reason `rate-limited` (the registry's own limit), anything else that
 * is not a 200 with a body matching the contract is `upstream-error`. Messages name the registry,
 * never the URL: it may carry a national ID.
 */
export async function getFromRegistry<T>(
  registry: string,
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  options: { notFound?: null } = {},
): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal });
  } catch (error) {
    throw new UpstreamError('upstream-error', `${registry} could not be reached`, {
      cause: error,
    });
  }

  if (response.status === 404 && 'notFound' in options) {
    await response.body?.cancel();
    return null;
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new UpstreamError('rate-limited', `${registry} refused the call: rate limit`);
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new UpstreamError('upstream-error', `${registry} answered ${String(response.status)}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new UpstreamError('upstream-error', `${registry} sent an unreadable body`, {
      cause: error,
    });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamError('upstream-error', `${registry} sent a body that breaks its contract`);
  }
  return parsed.data;
}

/** A path segment or query value, encoded. */
export const segment = (value: string) => encodeURIComponent(value);
