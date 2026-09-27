import 'reflect-metadata';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier } from '@adili/api-kit';
import { createDatabase, DATABASE, type Database } from '@adili/data-access';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';

import { AppModule } from '../../src/app.module.js';
import { config } from '../../src/config.js';
import { schema } from '../../src/db/schema.js';
import type { StructuredResult } from '../../src/providers/port.js';
import { MODEL_PROVIDER } from '../../src/providers/providers.module.js';
import { ReplayAdapter } from '../../src/providers/replay.adapter.js';
import { buildProviderRequest } from '../../src/tasks/provider-request.js';
import { findTask } from '../../src/tasks/registry.js';
import { ScriptedProvider } from './scripted-provider.js';

const MIGRATIONS = new URL('../../migrations', import.meta.url).pathname;

export interface TestApp {
  app: NestFastifyApplication;
  db: Database<typeof schema>;
  /** Signs an access token as the given OAuth client with the given scopes. */
  token: (options?: { clientId?: string; scope?: string }) => Promise<string>;
  /**
   * Records the provider's response to the request the gateway will make for this task input,
   * as record mode would, so the replay adapter serves it.
   */
  record: (task: string, input: unknown, result: StructuredResult) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Boots the service against a fresh Postgres schema in the shared test database and compose
 * Temporal, with the replay adapter serving fixtures from a temporary directory.
 */
export async function createTestApp(): Promise<TestApp> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const schemaName = `ai_gateway_test_${process.pid}_${Date.now()}`;
  const url = withSearchPath(baseUrl, schemaName);

  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 });
  await admin.query(`create schema "${schemaName}"`);
  const migrator = new pg.Pool({ connectionString: url, max: 1 });
  await migrate(drizzle({ client: migrator }), {
    migrationsFolder: MIGRATIONS,
    migrationsSchema: schemaName,
  });
  await migrator.end();

  const fixturesDir = await mkdtemp(join(tmpdir(), 'ai-gateway-fixtures-'));
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };

  const db = createDatabase({ url, schema, applicationName: 'ai-gateway-test' });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(
      new TokenVerifier(
        config.OIDC_ISSUER_URL,
        config.OIDC_AUDIENCE,
        createLocalJWKSet({ keys: [jwk] }),
      ),
    )
    .overrideProvider(MODEL_PROVIDER)
    .useValue(new ReplayAdapter({ fixturesDir, mode: 'replay' }))
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    db,
    token: ({ clientId = 'review', scope = 'profile ai' } = {}) =>
      new SignJWT({ azp: clientId, scope })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(config.OIDC_ISSUER_URL)
        .setAudience(config.OIDC_AUDIENCE)
        .setSubject(`service-account-${clientId}`)
        .setExpirationTime('5m')
        .sign(privateKey),
    record: async (taskName, input, result) => {
      const task = findTask(taskName);
      if (!task) throw new Error(`Unknown task ${taskName}`);
      const request = buildProviderRequest(
        task,
        task.currentPromptVersion,
        task.input.parse(input),
        { model: config.AI_MODEL, maxOutputTokens: task.maxOutputTokens },
      );
      const recorder = new ReplayAdapter({
        fixturesDir,
        mode: 'record',
        inner: new ScriptedProvider(() => Promise.resolve(result)),
      });
      await recorder.generateStructured(request);
    },
    close: async () => {
      // Closing the app stops the worker and ends the database pool.
      await app.close();
      await admin.query(`drop schema "${schemaName}" cascade`);
      await admin.end();
      await rm(fixturesDir, { recursive: true, force: true });
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
