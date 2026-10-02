import { resolve } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { type DynamicModule, Module } from '@nestjs/common';

import { AnthropicAdapter } from './anthropic.adapter.js';
import type { ModelProvider } from './port.js';
import type { ProviderEnv } from './provider-env.js';
import { ReplayAdapter } from './replay.adapter.js';

function anthropic(env: ProviderEnv): AnthropicAdapter {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL,
    timeout: env.AI_PROVIDER_TIMEOUT_MS,
    // Retries, backoff and the circuit breaker belong to the job executor, not the SDK.
    maxRetries: 0,
  });
  return new AnthropicAdapter({ client, structuredOutput: env.ANTHROPIC_STRUCTURED_OUTPUT });
}

export function createModelProvider(env: ProviderEnv): ModelProvider {
  if (env.AI_PROVIDER === 'anthropic') {
    return anthropic(env);
  }
  const fixturesDir = resolve(env.AI_FIXTURES_DIR);
  return env.AI_REPLAY_MODE === 'record'
    ? new ReplayAdapter({ fixturesDir, mode: 'record', inner: anthropic(env) })
    : new ReplayAdapter({ fixturesDir, mode: 'replay' });
}

/**
 * Injection token for the providers this process can reach, the configured one first. The
 * routing table names providers from this list; tests may register several.
 */
export const MODEL_PROVIDERS = Symbol('MODEL_PROVIDERS');

/** The providers this process can reach, by name; the first is the default route's. */
export class ProviderRegistry {
  readonly default: ModelProvider;
  private readonly byName: ReadonlyMap<string, ModelProvider>;

  constructor(providers: readonly ModelProvider[]) {
    const [first] = providers;
    if (!first) throw new Error('At least one model provider is required');
    this.default = first;
    this.byName = new Map(providers.map((provider) => [provider.name, provider]));
  }

  /** Undefined for a provider this process cannot reach (a routing row naming another). */
  get(name: string): ModelProvider | undefined {
    return this.byName.get(name);
  }
}

@Module({})
export class ProvidersModule {
  static forRoot(env: ProviderEnv): DynamicModule {
    return {
      module: ProvidersModule,
      providers: [
        { provide: MODEL_PROVIDERS, useFactory: () => [createModelProvider(env)] },
        {
          provide: ProviderRegistry,
          useFactory: (providers: ModelProvider[]) => new ProviderRegistry(providers),
          inject: [MODEL_PROVIDERS],
        },
      ],
      exports: [ProviderRegistry],
    };
  }
}
