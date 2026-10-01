import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import type { Type } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier } from '@adili/api-kit';
import { createValkey, VALKEY } from '@adili/cache';
import { createDatabase, DATABASE, type Database, FieldCipher } from '@adili/data-access';
import { FakeCipher } from '@adili/data-access/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';
import { vi } from 'vitest';

import {
  SYSTEM_POLICIES,
  type SystemPolicies,
  type SystemPolicy,
} from '../../src/adapter-kit/system-policies.js';
import { AppModule } from '../../src/app.module.js';
import { config } from '../../src/config.js';
import { schema } from '../../src/db/schema.js';
import { IPRS_CLIENT_OPTIONS, type IprsClientOptions } from '../../src/iprs/iprs-client.js';
import { REGISTRY_URLS, type RegistryUrls } from '../../src/registries/registry-urls.js';

const MIGRATIONS = new URL('../../migrations', import.meta.url).pathname;

/**
 * Holds `Date.now()`, which the circuit breaker (cockatiel) reads for its cool-down, still until
 * the test moves it. Timers are left alone, so timeouts still run in real time.
 */
export class Clock {
  private now = Date.now();
  private readonly spy = vi.spyOn(Date, 'now').mockImplementation(() => this.now);

  advance(ms: number): void {
    this.now += ms;
  }

  restore(): void {
    this.spy.mockRestore();
  }
}

export interface TestAppOptions extends Partial<IprsClientOptions> {
  /** IPRS's timeout. */
  timeoutMs?: number;
  /**
   * Policies of systems besides IPRS, e.g. for a stub adapter. KRA, NTSA, BRS and ArdhiSasa
   * default to the spec's timeout and cache with a rate the tests never reach.
   */
  policies?: SystemPolicies;
  /** Where the KRA, NTSA, BRS, ArdhiSasa and HR adapters call, e.g. `StubRegistries.urls`. */
  registryUrls?: RegistryUrls;
  /** Extra controllers, e.g. one exercising a kit decorator. */
  controllers?: Type[];
}

export interface TestApp {
  app: NestFastifyApplication;
  db: Database<typeof schema>;
  valkey: ReturnType<typeof createValkey>;
  /** The field cipher, real AES-GCM under keys derived from the tenant slug. */
  cipher: FakeCipher;
  clock: Clock;
  /** This app's cache keys, without the key prefix. */
  cacheKeys: () => Promise<string[]>;
  /** Empties this app's cache, leaving other suites' keys on the shared Valkey alone. */
  clearCache: () => Promise<void>;
  /**
   * Signs an access token as the given OAuth client with the given scopes, or, given realm roles,
   * as a user of `tenant` signed in through it.
   */
  token: (options?: {
    clientId?: string;
    scope?: string;
    roles?: string[];
    tenant?: string;
  }) => Promise<string>;
  close: () => Promise<void>;
}

/**
 * Boots the service against a fresh Postgres schema and Valkey key prefix, so parallel runs
 * never see each other's rows or cache entries, with IPRS's base URL and timeout overridden.
 */
export async function createTestApp({
  baseUrl: iprsBaseUrl = config.IPRS_BASE_URL,
  timeoutMs = config.IPRS_TIMEOUT_MS,
  policies = {},
  registryUrls,
  controllers = [],
}: TestAppOptions = {}): Promise<TestApp> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const schemaName = `integration_gateway_test_${process.pid}_${Date.now()}`;
  const url = withSearchPath(baseUrl, schemaName);

  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 });
  await admin.query(`create schema "${schemaName}"`);
  const migrator = new pg.Pool({ connectionString: url, max: 1 });
  await migrate(drizzle({ client: migrator }), {
    migrationsFolder: MIGRATIONS,
    migrationsSchema: schemaName,
  });
  await migrator.end();

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };

  const db = createDatabase({ url, schema, applicationName: 'integration-gateway-test' });
  const valkey = createValkey({
    url: requireEnv('TEST_VALKEY_URL'),
    keyPrefix: `integration-gateway-test-${randomUUID()}:`,
  });
  const clock = new Clock();
  const cipher = new FakeCipher();
  const iprsPolicy: SystemPolicy = {
    timeoutMs,
    cacheTtlSeconds: config.IPRS_CACHE_TTL_SECONDS,
    ratePerMinute: config.IPRS_RATE_LIMIT_PER_MINUTE,
    maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
  };
  const registryPolicy: SystemPolicy = {
    timeoutMs: 2_000,
    cacheTtlSeconds: 86_400,
    ratePerMinute: 60_000,
    maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
  };
  const prefix = valkey.options.keyPrefix ?? '';
  // KEYS takes its pattern as given (the key prefix is not applied), so match the prefix here.
  const cacheKeys = async () =>
    (await valkey.keys(`${prefix}*`)).map((key) => key.slice(prefix.length));
  let builder = Test.createTestingModule({ imports: [AppModule], controllers })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(VALKEY)
    .useValue(valkey)
    .overrideProvider(FieldCipher)
    .useValue(cipher)
    .overrideProvider(IPRS_CLIENT_OPTIONS)
    .useValue({ baseUrl: iprsBaseUrl } satisfies IprsClientOptions)
    .overrideProvider(SYSTEM_POLICIES)
    .useValue({
      iprs: iprsPolicy,
      kra: registryPolicy,
      ntsa: registryPolicy,
      brs: registryPolicy,
      ardhisasa: registryPolicy,
      ...policies,
    } satisfies SystemPolicies)
    .overrideProvider(TokenVerifier)
    .useValue(
      new TokenVerifier(
        config.OIDC_ISSUER_URL,
        config.OIDC_AUDIENCE,
        createLocalJWKSet({ keys: [jwk] }),
      ),
    );
  if (registryUrls) builder = builder.overrideProvider(REGISTRY_URLS).useValue(registryUrls);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    db,
    valkey,
    cipher,
    clock,
    cacheKeys,
    clearCache: async () => {
      const keys = await cacheKeys();
      if (keys.length > 0) await valkey.del(...keys);
    },
    token: ({ clientId = 'directory', scope = 'profile iprs', roles, tenant } = {}) =>
      new SignJWT({
        azp: clientId,
        scope,
        ...(roles ? { realm_access: { roles } } : {}),
        ...(tenant ? { tenant } : {}),
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(config.OIDC_ISSUER_URL)
        .setAudience(config.OIDC_AUDIENCE)
        .setSubject(roles ? `user-${roles.join('-')}` : `service-account-${clientId}`)
        // Outlives the clock moves of a whole run.
        .setExpirationTime('1h')
        .sign(privateKey),
    close: async () => {
      clock.restore();
      // Closing the app ends the database pool and the Valkey connection.
      await app.close();
      await admin.query(`drop schema "${schemaName}" cascade`);
      await admin.end();
    },
  };
}

function withSearchPath(url: string, schemaName: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${schemaName}`);
  return parsed.toString();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required (see vitest.integration.config.ts)`);
  }
  return value;
}
