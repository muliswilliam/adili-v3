import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier } from '@adili/api-kit';
import { createValkey, VALKEY } from '@adili/cache';
import { createDatabase, DATABASE, type Database } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';

import { AppModule } from '../../src/app.module.js';
import {
  ActivationLookups,
  InMemoryActivationLookups,
} from '../../src/commissions/activation-lookups.js';
import { type DirectorySchema, schema } from '../../src/db/schema.js';
import { IdentityProvisioning } from '../../src/identity/identity-provisioning.js';
import { InMemoryIdentityProvisioning } from '../../src/identity/in-memory-identity-provisioning.js';
import { InMemoryRosterUploads } from '../../src/roster/import/in-memory-roster-uploads.js';
import { RosterUploads } from '../../src/roster/import/roster-uploads.js';

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';
const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export interface Caller {
  sub?: string;
  tenant?: string | null;
  roles?: string[];
  /** The `name` claim; absent by default. */
  name?: string;
  /** The `scope` claim (space-separated), as client-credentials tokens carry; absent by default. */
  scope?: string;
  /** The `azp` claim: `console` by default, an HR system's client id for machine callers. */
  azp?: string;
  /** The `iat` claim in seconds since the epoch: when the token is signed by default. */
  iat?: number;
}

export interface WriteOptions {
  /** Random by default; null sends no header. */
  idempotencyKey?: string | null;
}

export interface DirectoryApi {
  app: NestFastifyApplication;
  /** Direct database access for arranging fixtures; assertions go through HTTP. */
  db: Database<DirectorySchema>;
  identity: InMemoryIdentityProvisioning;
  /** Roster uploads the import endpoints read, standing in for the documents service. */
  uploads: InMemoryRosterUploads;
  /** The activation observer's cache of subjects without an invitation. */
  activationLookups: InMemoryActivationLookups;
  /** `GET` as the given caller; returns Fastify's injected response. */
  get(url: string, caller: Caller): ReturnType<NestFastifyApplication['inject']>;
  /** `POST` a JSON body as the given caller, with an `Idempotency-Key` unless it is null. */
  post(
    url: string,
    body: unknown,
    caller: Caller,
    options?: WriteOptions,
  ): ReturnType<NestFastifyApplication['inject']>;
  /** `PUT` a JSON body as the given caller, with an `Idempotency-Key` unless it is null. */
  put(
    url: string,
    body: unknown,
    caller: Caller,
    options?: WriteOptions,
  ): ReturnType<NestFastifyApplication['inject']>;
  /** `DELETE` as the given caller. */
  delete(url: string, caller: Caller): ReturnType<NestFastifyApplication['inject']>;
  /** Empties every directory table except seeded reference data. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The directory service over HTTP against a real Postgres (`TEST_DATABASE_URL`), with tokens
 * signed locally, the in-memory identity adapter and in-memory roster uploads. Each suite gets a
 * private Postgres schema with the service's migrations applied, so suites can share the test
 * database. Roster imports run on compose Temporal through the service's own worker, polling a
 * task queue of the suite's own (test/support/temporal-task-queue.ts).
 */
export async function startDirectoryApi(): Promise<DirectoryApi> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const pgSchema = `directory_test_${process.pid}_${randomUUID().slice(0, 8)}`;
  const url = withSearchPath(baseUrl, pgSchema);

  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'directory-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();

  const db = createDatabase({ url, schema, applicationName: 'directory-test' });
  await applyMigrations(db);

  const { signer, jwk } = await tokenSigner();
  const identity = new InMemoryIdentityProvisioning();
  const activationLookups = new InMemoryActivationLookups();
  const uploads = new InMemoryRosterUploads();
  // The suite's own key prefix, so rate limit budgets and throttles start fresh and never meet
  // another suite's (or an earlier run's) on the shared Valkey.
  const valkey = createValkey({
    url: requireEnv('TEST_VALKEY_URL'),
    keyPrefix: `${pgSchema}:`,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] })))
    .overrideProvider(IdentityProvisioning)
    .useValue(identity)
    .overrideProvider(ActivationLookups)
    .useValue(activationLookups)
    .overrideProvider(RosterUploads)
    .useValue(uploads)
    .overrideProvider(VALKEY)
    .useValue(valkey)
    .compile();
  // Quiet like LOG_LEVEL=fatal in the service; expected 5xx in tests would otherwise log errors.
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: ['fatal'],
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const write = async (
    method: 'POST' | 'PUT',
    path: string,
    body: unknown,
    caller: Caller,
    { idempotencyKey = randomUUID() }: WriteOptions = {},
  ) => {
    const token = await signer(caller);
    return app.inject({
      method,
      url: path,
      headers: {
        authorization: `Bearer ${token}`,
        ...(idempotencyKey === null ? {} : { 'idempotency-key': idempotencyKey }),
      },
      payload: body as Record<string, unknown>,
    });
  };

  return {
    app,
    db,
    identity,
    uploads,
    activationLookups,
    async get(path, caller) {
      const token = await signer(caller);
      return app.inject({
        method: 'GET',
        url: path,
        headers: { authorization: `Bearer ${token}` },
      });
    },
    post(path, body, caller, options) {
      return write('POST', path, body, caller, options);
    },
    put(path, body, caller, options) {
      return write('PUT', path, body, caller, options);
    },
    async delete(path, caller) {
      const token = await signer(caller);
      return app.inject({
        method: 'DELETE',
        url: path,
        headers: { authorization: `Bearer ${token}` },
      });
    },
    async reset() {
      await db.execute(
        sql`truncate roster_import_batches, roster_import_rows, roster_records, reporting_entities, roster_summaries, roster_imports, roster_api_credentials, reporting_officer_assignments, tenant_policy_versions, commission_categories, commissions, outbox, inbox, idempotency_keys`,
      );
      identity.reset();
      uploads.reset();
      activationLookups.expireAll();
    },
    async close() {
      // Closing the app ends the pool (DatabaseModule lifecycle), so drop the schema first.
      await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
      await app.close();
    },
  };
}

/** Applies the committed migrations in journal order inside the private schema. */
async function applyMigrations(db: Database<DirectorySchema>): Promise<void> {
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', MIGRATIONS), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const { tag } of journal.entries) {
    // drizzle-kit qualifies foreign key targets with "public"; resolve them in the test schema.
    const migration = readFileSync(new URL(`${tag}.sql`, MIGRATIONS), 'utf8').replaceAll(
      '"public".',
      '',
    );
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await db.execute(sql.raw(statement));
    }
  }
}

async function tokenSigner(): Promise<{ signer: (caller: Caller) => Promise<string>; jwk: JWK }> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  const signer = ({
    sub = randomUUID(),
    tenant = null,
    roles = [],
    name,
    scope,
    azp = 'console',
    iat,
  }: Caller) =>
    new SignJWT({ azp, tenant, realm_access: { roles }, name, scope })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuedAt(iat)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(sub)
      .setExpirationTime('5m')
      .sign(privateKey);
  return { signer, jwk };
}

function withSearchPath(databaseUrl: string, pgSchema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);
  return url.toString();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see vitest.integration.config.ts`);
  return value;
}
