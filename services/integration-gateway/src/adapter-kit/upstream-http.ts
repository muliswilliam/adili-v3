import type { z } from 'zod';

import { UpstreamError } from './upstream-error.js';

export interface UpstreamRequest {
  /** The system as messages name it (`KRA`, `Payroll`): never the URL, which may carry an ID. */
  name: string;
  url: string;
  signal: AbortSignal;
  /** Sent as JSON with a POST; a GET without. Personal data travels here, never in `url`. */
  body?: unknown;
  /** The statuses that answer with a body to parse; 200 when unset. */
  ok?: readonly number[];
  /** Resolve to null on 404, when the system says it has no record. */
  notFound?: null;
}

/**
 * Calls one system's resource and parses its answer with `schema` (the external contract's shape,
 * in snake_case, transformed to ours). Resolves to null on 404 when `notFound` is `null`; a 429 is
 * an `UpstreamError` with reason `rate-limited` (the system's own limit), anything else that is
 * not an `ok` status with a body matching the contract is `upstream-error`. Messages name the
 * system, never the URL or the body.
 */
export async function callUpstream<T>(
  request: UpstreamRequest,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const { name, url, signal, body, ok = [200] } = request;
  let response: Response;
  try {
    response = await fetch(
      url,
      body === undefined
        ? { headers: { accept: 'application/json' }, signal }
        : {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          },
    );
  } catch (error) {
    throw new UpstreamError('upstream-error', `${name} could not be reached`, { cause: error });
  }

  if (response.status === 404 && 'notFound' in request) {
    await response.body?.cancel();
    return null;
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new UpstreamError('rate-limited', `${name} refused the call: rate limit`);
  }
  if (!ok.includes(response.status)) {
    await response.body?.cancel();
    throw new UpstreamError('upstream-error', `${name} answered ${String(response.status)}`);
  }
  let answer: unknown;
  try {
    answer = await response.json();
  } catch (error) {
    throw new UpstreamError('upstream-error', `${name} sent an unreadable body`, { cause: error });
  }
  const parsed = schema.safeParse(answer);
  if (!parsed.success) {
    throw new UpstreamError('upstream-error', `${name} sent a body that breaks its contract`);
  }
  return parsed.data;
}
