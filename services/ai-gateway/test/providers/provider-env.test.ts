import { describe, expect, it } from 'vitest';

import { providerEnvSchema } from '../../src/providers/provider-env.js';
import { AnthropicAdapter } from '../../src/providers/anthropic.adapter.js';
import { createModelProvider } from '../../src/providers/providers.module.js';
import { ReplayAdapter } from '../../src/providers/replay.adapter.js';

const parse = (env: Record<string, string>) => providerEnvSchema.parse(env);

describe('provider environment', () => {
  it('replays fixtures by default outside production and needs no key', () => {
    const env = parse({});
    expect(env).toMatchObject({ AI_PROVIDER: 'replay', AI_REPLAY_MODE: 'replay' });
    expect(createModelProvider(env)).toBeInstanceOf(ReplayAdapter);
  });

  it('calls Anthropic directly when selected', () => {
    const provider = createModelProvider(
      parse({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' }),
    );
    expect(provider).toBeInstanceOf(AnthropicAdapter);
  });

  it('records from Anthropic in record mode', () => {
    const provider = createModelProvider(
      parse({ AI_REPLAY_MODE: 'record', ANTHROPIC_API_KEY: 'sk-test' }),
    );
    expect(provider).toBeInstanceOf(ReplayAdapter);
    expect(provider.name).toBe('replay');
  });

  it('requires a key whenever Anthropic is reached', () => {
    expect(() => parse({ AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parse({ AI_REPLAY_MODE: 'record' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('requires an explicit provider in production', () => {
    expect(() => parse({ NODE_ENV: 'production' })).toThrow(/AI_PROVIDER/);
    expect(parse({ NODE_ENV: 'production', AI_PROVIDER: 'replay' })).toMatchObject({
      AI_PROVIDER: 'replay',
    });
  });

  it('refuses record mode in production', () => {
    expect(() =>
      parse({
        NODE_ENV: 'production',
        AI_PROVIDER: 'replay',
        AI_REPLAY_MODE: 'record',
        ANTHROPIC_API_KEY: 'sk-test',
      }),
    ).toThrow(/AI_REPLAY_MODE/);
  });
});
