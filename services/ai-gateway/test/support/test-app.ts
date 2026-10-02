import 'reflect-metadata';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PLATFORM_TENANT, TokenVerifier } from '@adili/api-kit';
import { TEMPORAL_CLIENT, TemporalWorkerReadinessCheck, WorkflowBundler } from '@adili/temporal';
import { prebuiltWorkflowBundler, untilWorkerPolling } from '@adili/temporal/testing';
import type { Client } from '@temporalio/client';
import { createDatabase, DATABASE, type Database, FieldCipher } from '@adili/data-access';
import { FakeCipher } from '@adili/data-access/testing';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';
import { inject } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { config } from '../../src/config.js';
import { jobs, schema } from '../../src/db/schema.js';
import { LIVE_STATUSES } from '../../src/jobs/job-states.js';
import { BREAKER_OPTIONS, type BreakerOptions } from '../../src/policy/circuit-breaker.js';
import type { ModelProvider, StructuredResult } from '../../src/providers/port.js';
import { MODEL_PROVIDERS } from '../../src/providers/providers.module.js';
import { ReplayAdapter } from '../../src/providers/replay.adapter.js';
import { seedDemoGatePolicies } from '../../src/policy/demo-seed.js';
import { GatePolicies } from '../../src/policy/gate-policies.js';
import { preparePrompt } from '../../src/policy/prompt.js';
import { findTask } from '../../src/tasks/registry.js';
import { ScriptedProvider } from './scripted-provider.js';

const MIGRATIONS = new URL('../../migrations', import.meta.url).pathname;

export interface TestApp {
  app: NestFastifyApplication;
  /**
   * The test's own connection, in the platform context: it sees and writes every tenant's rows,
   * for setting up and checking what the service did.
   */
  db: Database<typeof schema>;
  /** The service's connection, without a context: its tables' row-level security applies. */
  serviceDb: Database<typeof schema>;
  /** Signs an access token as the given OAuth client with the given scopes. */
  token: (options?: { clientId?: string; scope?: string }) => Promise<string>;
  /** Signs a staff user's access token with the given realm roles. */
  userToken: (options: { subject: string; roles: string[]; name?: string }) => Promise<string>;
  /**
   * Records the provider's response to the request the gateway will make for this task input
   * (minimised, wrapped), as record mode would, so the replay adapter serves it.
   */
  record: (
    task: string,
    input: unknown,
    result: StructuredResult,
    options?: { model?: string },
  ) => Promise<void>;
  /**
   * Records the demo seed's rule (external providers on synthetic data) for these tenants, as
   * `pnpm db:seed` does for the demo tenant; every other tenant keeps external blocked.
   */
  seedDemoGate: (...tenants: string[]) => Promise<void>;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /** Replaces the replay adapter, which otherwise serves fixtures from a temporary directory. */
  provider?: ModelProvider;
  /** Further providers the routing table may name. */
  extraProviders?: ModelProvider[];
  /** Replaces the configured circuit breaker settings. */
  breaker?: BreakerOptions;
}

/**
 * Boots the service against a fresh Postgres schema in the shared test database and compose
 * Temporal, with the replay adapter serving fixtures from a temporary directory.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
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

  const serviceDb = createDatabase({ url, schema, applicationName: 'ai-gateway-test' });
  // Every tenant table is under FORCE row-level security; the platform context (ADR-006) of this
  // connection's sessions lets the test see all of them.
  const db = createDatabase({
    url: withSettings(url, { 'app.tenant': PLATFORM_TENANT }),
    schema,
    applicationName: 'ai-gateway-test-platform',
    maxConnections: 2,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(serviceDb)
    .overrideProvider(FieldCipher)
    .useValue(new FakeCipher())
    .overrideProvider(TokenVerifier)
    .useValue(
      new TokenVerifier(
        config.OIDC_ISSUER_URL,
        config.OIDC_AUDIENCE,
        createLocalJWKSet({ keys: [jwk] }),
      ),
    )
    .overrideProvider(MODEL_PROVIDERS)
    .useValue([
      options.provider ?? new ReplayAdapter({ fixturesDir, mode: 'replay' }),
      ...(options.extraProviders ?? []),
    ])
    .overrideProvider(BREAKER_OPTIONS)
    .useValue(
      options.breaker ?? {
        failureThreshold: config.AI_BREAKER_FAILURE_THRESHOLD,
        cooldownMs: config.AI_BREAKER_COOLDOWN_MS,
      },
    )
    .overrideProvider(WorkflowBundler)
    .useValue(prebuiltWorkflowBundler(inject('workflowBundles')))
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  // Tests start once the worker polls, as traffic waits for readiness (see untilWorkerPolling).
  await untilWorkerPolling(app.get(TemporalWorkerReadinessCheck));

  return {
    app,
    db,
    serviceDb,
    token: ({ clientId = 'review', scope = 'profile ai' } = {}) =>
      new SignJWT({ azp: clientId, scope })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(config.OIDC_ISSUER_URL)
        .setAudience(config.OIDC_AUDIENCE)
        .setSubject(`service-account-${clientId}`)
        .setExpirationTime('5m')
        .sign(privateKey),
    userToken: ({ subject, roles, name }) =>
      new SignJWT({ azp: 'console', scope: 'openid profile', realm_access: { roles }, name })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(config.OIDC_ISSUER_URL)
        .setAudience(config.OIDC_AUDIENCE)
        .setSubject(subject)
        .setExpirationTime('5m')
        .sign(privateKey),
    record: async (taskName, input, result, { model = config.AI_MODEL } = {}) => {
      const task = findTask(taskName);
      if (!task) throw new Error(`Unknown task ${taskName}`);
      const { request } = preparePrompt(
        task,
        task.currentPromptVersion,
        task.input.parse(input),
        model,
      );
      const recorder = new ReplayAdapter({
        fixturesDir,
        mode: 'record',
        inner: new ScriptedProvider(() => Promise.resolve(result)),
      });
      await recorder.generateStructured(request);
    },
    seedDemoGate: async (...tenants) => {
      await seedDemoGatePolicies(app.get(GatePolicies), tenants);
    },
    close: async () => {
      // Jobs a test did not wait for would otherwise sit on this file's queue, which no worker
      // polls once the app is closed.
      const temporal = app.get<Client>(TEMPORAL_CLIENT);
      const live = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.status, LIVE_STATUSES));
      await Promise.all(
        live.map(({ id }) =>
          temporal.workflow
            .getHandle(`ai-job-${id}`)
            .terminate('test app closed')
            .catch(() => undefined),
        ),
      );
      // Closing the app stops the worker and ends the service's database pool.
      await app.close();
      await db.$client.end();
      await admin.query(`drop schema "${schemaName}" cascade`);
      await admin.end();
      await rm(fixturesDir, { recursive: true, force: true });
    },
  };
}

function withSearchPath(url: string, schemaName: string): string {
  return withSettings(url, { search_path: schemaName });
}

/** `url` with these session settings added to its `options`. */
function withSettings(url: string, settings: Record<string, string>): string {
  const parsed = new URL(url);
  const options = [
    parsed.searchParams.get('options'),
    ...Object.entries(settings).map(([name, value]) => `-c ${name}=${value}`),
  ].filter(Boolean);
  parsed.searchParams.set('options', options.join(' '));
  return parsed.toString();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required (see vitest.integration.config.ts)`);
  }
  return value;
}
