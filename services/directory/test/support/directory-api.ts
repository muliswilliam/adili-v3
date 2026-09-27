import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier } from '@adili/api-kit';
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

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';
const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export interface Caller {
  sub?: string;
  tenant?: string | null;
  roles?: string[];
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
  /** Empties every directory table except seeded reference data. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The directory service over HTTP against a real Postgres (`TEST_DATABASE_URL`), with tokens
 * signed locally and the in-memory identity adapter. Each suite gets a private Postgres schema
 * with the service's migrations applied, so suites can share the test database.
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] })))
    .overrideProvider(IdentityProvisioning)
    .useValue(identity)
    .overrideProvider(ActivationLookups)
    .useValue(activationLookups)
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
    async reset() {
      await db.execute(
        sql`truncate reporting_officer_assignments, tenant_policy_versions, commission_categories, commissions, outbox, inbox, idempotency_keys`,
      );
      identity.reset();
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
  const signer = ({ sub = randomUUID(), tenant = null, roles = [] }: Caller) =>
    new SignJWT({ azp: 'console', tenant, realm_access: { roles } })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
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
