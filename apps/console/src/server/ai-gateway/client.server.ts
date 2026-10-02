import { mockableClient } from '@adili/api-kit/client';

import { env } from '../env.server';
import type { paths } from './api.gen';

/**
 * Typed client for the ai-gateway's policy endpoints, generated from
 * `packages/schemas/internal/ai-gateway.yaml`, called as the signed-in platform admin. With
 * AI_GATEWAY_MOCK set in development it talks to the in-memory mock instead (`mock.server.ts`).
 */
export function aiGatewayClient(accessToken: string) {
  const config = env();
  return mockableClient<paths>({
    baseUrl: config.AI_GATEWAY_API_URL,
    headers: { authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
    // Inline, so production builds drop the mock (see mockableClient).
    mock:
      import.meta.env.DEV && config.AI_GATEWAY_MOCK
        ? async (request) => (await import('./mock.server')).mockAiGatewayFetch(request)
        : null,
  });
}

export type AiGatewayClient = ReturnType<typeof aiGatewayClient>;
