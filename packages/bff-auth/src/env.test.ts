import { describe, expect, it } from 'vitest';

import { bffEnvSchema, parseEnv } from './env.ts';

const valid = {
  APP_URL: 'http://localhost:3010',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/adili',
  OIDC_CLIENT_ID: 'portal',
  OIDC_CLIENT_SECRET: 'secret',
  VALKEY_URL: 'redis://localhost:56379',
};

describe('parseEnv', () => {
  it('parses a complete environment with defaults', () => {
    expect(parseEnv(bffEnvSchema, valid)).toEqual({ ...valid, NODE_ENV: 'development' });
  });

  it('lists every invalid variable', () => {
    expect(() => parseEnv(bffEnvSchema, { ...valid, APP_URL: 'nope', OIDC_CLIENT_ID: '' })).toThrow(
      /APP_URL[\s\S]*OIDC_CLIENT_ID/,
    );
  });
});
