import { baseEnvSchema } from '@adili/api-kit';
import { z } from 'zod';

const PROVIDERS = ['replay', 'anthropic'] as const;

/** The model every task runs on without a routing row for it; evals record on it too. */
export const DEFAULT_AI_MODEL = 'claude-opus-5-5';

export const providerEnvShape = {
  /**
   * `replay` serves recorded fixtures (tests, CI, demo); `anthropic` calls the API. Defaults to
   * `replay` outside production; production must choose, so a missing setting cannot quietly
   * turn every job into a missing-fixture failure.
   */
  AI_PROVIDER: z.enum(PROVIDERS).optional(),
  /**
   * With `AI_PROVIDER=replay`: `record` calls Anthropic and writes the full request into the
   * fixtures, which are committed. Synthetic inputs only; refused in production.
   */
  AI_REPLAY_MODE: z.enum(['replay', 'record']).default('replay'),
  /**
   * With `AI_PROVIDER=replay`: `exact` matches recordings byte for byte; `normalised` ignores the
   * ids and timestamps a fresh run of the same demo beat mints anew (see ReplayMatch).
   */
  AI_REPLAY_MATCH: z.enum(['exact', 'normalised']).default('exact'),
  /** Resolved from the working directory. */
  AI_FIXTURES_DIR: z.string().min(1).default('fixtures/ai'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /**
   * A bearer token instead of an API key, for an Anthropic-compatible gateway that authenticates
   * with `Authorization: Bearer` (a self-hosted LLM Gateway). Takes precedence over ANTHROPIC_API_KEY.
   */
  ANTHROPIC_AUTH_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.url().optional(),
  /**
   * `prompted` for an Anthropic-compatible gateway that drops `output_config`: the schema goes
   * into the system prompt instead (see AnthropicAdapter). `native` for the Anthropic API.
   */
  ANTHROPIC_STRUCTURED_OUTPUT: z.enum(['native', 'prompted']).default('native'),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /** Model for every task until the routing table (spec 07c BE-3) lands. */
  AI_MODEL: z.string().min(1).default(DEFAULT_AI_MODEL),
};

type ParsedProviderEnv = z.infer<z.ZodObject<typeof providerEnvShape>> & {
  NODE_ENV: z.infer<typeof baseEnvSchema.shape.NODE_ENV>;
};

/** Fails at startup, not on the first job, for settings that cannot work together. */
export function checkProviderEnv(env: ParsedProviderEnv, context: z.RefinementCtx): void {
  const production = env.NODE_ENV === 'production';
  if (production && env.AI_PROVIDER === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['AI_PROVIDER'],
      message: 'AI_PROVIDER is required in production',
    });
  }
  if (production && env.AI_REPLAY_MODE === 'record') {
    context.addIssue({
      code: 'custom',
      path: ['AI_REPLAY_MODE'],
      message: 'AI_REPLAY_MODE=record writes prompts to fixture files and is refused in production',
    });
  }
  if (env.AI_PROVIDER === 'anthropic' && env.AI_REPLAY_MODE === 'record') {
    context.addIssue({
      code: 'custom',
      path: ['AI_REPLAY_MODE'],
      message:
        'AI_REPLAY_MODE=record only applies with AI_PROVIDER=replay, which records from Anthropic',
    });
  }
  const reachesAnthropic = env.AI_PROVIDER === 'anthropic' || env.AI_REPLAY_MODE === 'record';
  if (reachesAnthropic && !env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
    context.addIssue({
      code: 'custom',
      path: ['ANTHROPIC_API_KEY'],
      message:
        'ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required when AI_PROVIDER=anthropic or ' +
        'AI_REPLAY_MODE=record',
    });
  }
}

/** Applies the non-production provider default once the environment is known to be valid. */
export function withProviderDefaults<TEnv extends ParsedProviderEnv>(
  env: TEnv,
): TEnv & { AI_PROVIDER: (typeof PROVIDERS)[number] } {
  return { ...env, AI_PROVIDER: env.AI_PROVIDER ?? 'replay' };
}

/** The provider settings on their own, for building a provider outside the service config. */
export const providerEnvSchema = z
  .object({ NODE_ENV: baseEnvSchema.shape.NODE_ENV, ...providerEnvShape })
  .superRefine(checkProviderEnv)
  .transform(withProviderDefaults);

export type ProviderEnv = z.output<typeof providerEnvSchema>;
