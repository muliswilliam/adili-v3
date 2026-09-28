import { createHash } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

/**
 * Fingerprint of what the client asked for: method, URL and body. JSON bodies are hashed in
 * canonical form (sorted keys), so the same payload serialised differently still matches.
 */
export function hashRequest(request: Pick<FastifyRequest, 'method' | 'url' | 'body'>): string {
  const { body } = request;
  const payload =
    typeof body === 'string' || Buffer.isBuffer(body) ? body : canonicalJson(body ?? null);
  return createHash('sha256')
    .update(`${request.method} ${request.url}\n`)
    .update(payload)
    .digest('hex');
}

/** JSON with object keys sorted at every level, so equal values serialise equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested).sort(([left], [right]) => (left < right ? -1 : 1)),
        )
      : nested,
  );
}
