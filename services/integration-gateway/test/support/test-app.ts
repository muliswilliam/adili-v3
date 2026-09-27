import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier } from '@adili/api-kit';
import { createValkey, VALKEY } from '@adili/cache';
import { createDatabase, DATABASE, type Database } from '@adili/data-access';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';
import { vi } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { config } from '../../src/config.js';
import { schema } from '../../src/db/schema.js';
import { IPRS_CLIENT_OPTIONS, type IprsClientOptions } from '../../src/iprs/iprs-client.js';

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

export interface TestApp {
  app: NestFastifyApplication;
  db: Database<typeof schema>;
  valkey: ReturnType<typeof createValkey>;
  clock: Clock;
  /** Signs an access token as the given OAuth client with the given scopes. */
  token: (options?: { clientId?: string; scope?: string }) => Promise<string>;
  close: () => Promise<void>;
}

/**
 * Boots the service against a fresh Postgres schema and Valkey key prefix, so parallel runs
 * never see each other's rows or cache entries, with the IPRS client options overridden by `iprs`.
 */
export async function createTestApp(iprs: Partial<IprsClientOptions> = {}): Promise<TestApp> {
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(VALKEY)
    .useValue(valkey)
    .overrideProvider(IPRS_CLIENT_OPTIONS)
    .useValue({
      baseUrl: config.IPRS_BASE_URL,
      timeoutMs: config.IPRS_TIMEOUT_MS,
      ...iprs,
    } satisfies IprsClientOptions)
    .overrideProvider(TokenVerifier)
    .useValue(
      new TokenVerifier(
        config.OIDC_ISSUER_URL,
        config.OIDC_AUDIENCE,
        createLocalJWKSet({ keys: [jwk] }),
      ),
    )
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    db,
    valkey,
    clock,
    token: ({ clientId = 'directory', scope = 'profile iprs' } = {}) =>
      new SignJWT({ azp: clientId, scope })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(config.OIDC_ISSUER_URL)
        .setAudience(config.OIDC_AUDIENCE)
        .setSubject(`service-account-${clientId}`)
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
