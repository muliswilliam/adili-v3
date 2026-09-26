import { resolve } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { type DynamicModule, Inject, Module } from '@nestjs/common';
import { z } from 'zod';

import { AnthropicAdapter } from './anthropic.adapter.js';
import type { ModelProvider } from './port.js';
import { ReplayAdapter } from './replay.adapter.js';

export const providerEnvShape = {
  /** `replay` serves recorded fixtures (tests, CI, demo); `anthropic` calls the API. */
  AI_PROVIDER: z.enum(['replay', 'anthropic']).default('replay'),
  /** With `AI_PROVIDER=replay`: `record` calls Anthropic and refreshes the fixtures. */
  AI_REPLAY_MODE: z.enum(['replay', 'record']).default('replay'),
  /** Resolved from the working directory. */
  AI_FIXTURES_DIR: z.string().min(1).default('fixtures/ai'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.url().optional(),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
};

type ProviderEnvShape = z.infer<z.ZodObject<typeof providerEnvShape>>;

/** Fails at startup, not on the first job, when Anthropic would be reached without a key. */
export function requireAnthropicKey(env: ProviderEnvShape, context: z.RefinementCtx): void {
  const reachesAnthropic = env.AI_PROVIDER === 'anthropic' || env.AI_REPLAY_MODE === 'record';
  if (reachesAnthropic && !env.ANTHROPIC_API_KEY) {
    context.addIssue({
      code: 'custom',
      path: ['ANTHROPIC_API_KEY'],
      message: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic or AI_REPLAY_MODE=record',
    });
  }
}

export const providerEnvSchema = z.object(providerEnvShape).superRefine(requireAnthropicKey);

export type ProviderEnv = z.infer<typeof providerEnvSchema>;

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
