import { parseEnv } from '@adili/bff-auth';
import { describe, expect, it } from 'vitest';

import { envSchema } from './env.server';

const base = {
  APP_URL: 'http://localhost:3010',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/adili',
  OIDC_CLIENT_ID: 'portal',
  OIDC_CLIENT_SECRET: 'secret',
  VALKEY_URL: 'redis://localhost:56379',
  DIRECTORY_API_URL: 'http://localhost:4001',
};

describe('portal env', () => {
  it('trusts one proxy hop by default, the edge proxy every deployment runs behind', () => {
    expect(parseEnv(envSchema, base).TRUSTED_PROXY_HOPS).toBe(1);
  });

  it('accepts an explicit hop count, including 0 for no proxy', () => {
    expect(parseEnv(envSchema, { ...base, TRUSTED_PROXY_HOPS: '0' }).TRUSTED_PROXY_HOPS).toBe(0);
    expect(parseEnv(envSchema, { ...base, TRUSTED_PROXY_HOPS: '2' }).TRUSTED_PROXY_HOPS).toBe(2);
  });

  it('rejects a negative hop count', () => {
    expect(() => parseEnv(envSchema, { ...base, TRUSTED_PROXY_HOPS: '-1' })).toThrow(
      /TRUSTED_PROXY_HOPS/,
    );
  });
});
