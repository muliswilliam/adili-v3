import { resolve } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { type DynamicModule, Inject, Module } from '@nestjs/common';

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
  return new AnthropicAdapter({ client });
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

/** Injection token for the configured `ModelProvider`. */
export const MODEL_PROVIDER = Symbol('MODEL_PROVIDER');
export const InjectModelProvider = () => Inject(MODEL_PROVIDER);

@Module({})
export class ProvidersModule {
  static forRoot(env: ProviderEnv): DynamicModule {
    return {
      module: ProvidersModule,
      providers: [{ provide: MODEL_PROVIDER, useFactory: () => createModelProvider(env) }],
      exports: [MODEL_PROVIDER],
    };
  }
}
