import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier } from '@adili/api-kit';
import { createDatabase, DATABASE, type Database, withTenant } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';

import { AppModule } from '../../src/app.module.js';
import { type DocumentsSchema, schema, uploads } from '../../src/db/schema.js';
import { ClamdScanner, MalwareScanner } from '../../src/scanning/malware-scanner.js';
import { S3, S3_PUBLIC } from '../../src/storage/storage.module.js';
import { COMPLETE_BUDGET_MS } from '../../src/uploads/uploads.service.js';

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';
const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export interface Caller {
  sub?: string;
  tenant?: string | null;
  roles?: string[];
  /** Space-separated OAuth scopes, as service tokens carry them. */
  scope?: string;
  azp?: string;
}

export interface DocumentsApiOptions {
  /** Replaces the clamd scanner, e.g. with one that never answers. */
  scanner?: MalwareScanner;
  completeBudgetMs?: number;
  /**
   * Also accept tokens Keycloak issues at this realm (e.g. a service's client credentials
   * token); locally signed tokens keep working.
   */
  keycloakIssuerUrl?: string;
}

export interface DocumentsApi {
  app: NestFastifyApplication;
  /** Direct database access for arranging fixtures; assertions go through HTTP. */
  db: Database<DocumentsSchema>;
  /** The storage the service uses (compose SeaweedFS), for arranging and inspecting objects. */
  s3: S3Client;
  get(url: string, caller: Caller, headers?: Record<string, string>): Promise<InjectResponse>;
  /**
   * Sends a fresh Idempotency-Key unless `idempotencyKey` names one, or is null to send none.
   */
  post(
    url: string,
    body: unknown,
    caller: Caller,
    options?: { idempotencyKey?: string | null; headers?: Record<string, string> },
  ): Promise<InjectResponse>;
  close(): Promise<void>;
}

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

/**
 * The documents service over HTTP against a real Postgres (`TEST_DATABASE_URL`), SeaweedFS
 * (`TEST_S3_ENDPOINT`) and ClamAV (`TEST_CLAMAV_HOST`/`PORT`), with tokens signed locally.
 * Each suite gets a private Postgres schema with the service's migrations applied.
 */
export async function startDocumentsApi(options: DocumentsApiOptions = {}): Promise<DocumentsApi> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const pgSchema = `documents_test_${process.pid}_${randomUUID().slice(0, 8)}`;
  const url = withSearchPath(baseUrl, pgSchema);

  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'documents-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();

  const db = createDatabase({ url, schema, applicationName: 'documents-test' });
  await applyMigrations(db);

  const s3 = testS3Client();
  const { signer, jwk } = await tokenSigner();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(verifier(jwk, options.keycloakIssuerUrl))
    .overrideProvider(S3)
    .useValue(s3)
    .overrideProvider(S3_PUBLIC)
    .useValue(testS3Client())
    .overrideProvider(MalwareScanner)
    .useValue(
      options.scanner ??
        new ClamdScanner(requireEnv('TEST_CLAMAV_HOST'), Number(requireEnv('TEST_CLAMAV_PORT'))),
    );
  if (options.completeBudgetMs !== undefined) {
    builder = builder.overrideProvider(COMPLETE_BUDGET_MS).useValue(options.completeBudgetMs);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: ['fatal'],
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    db,
    s3,
    async get(path, caller, headers = {}) {
      const token = await signer(caller);
      return app.inject({
        method: 'GET',
        url: path,
        headers: { authorization: `Bearer ${token}`, ...headers },
      });
    },
    async post(path, body, caller, { idempotencyKey = randomUUID(), headers = {} } = {}) {
      const token = await signer(caller);
      return app.inject({
        method: 'POST',
        url: path,
        headers: {
          authorization: `Bearer ${token}`,
          ...(idempotencyKey === null ? {} : { 'idempotency-key': idempotencyKey }),
          ...headers,
        },
        ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
      });
    },
    async close() {
      // The buckets are shared with the local stack: remove this suite's objects.
      const keys = await withTenant(db, { tenant: 'platform', subject: 'test' }, (tx) =>
        tx.select({ key: uploads.quarantineKey }).from(uploads),
      );
      for (const bucket of [requireEnv('S3_BUCKET_QUARANTINE'), requireEnv('S3_BUCKET_CLEAN')]) {
        for (let at = 0; at < keys.length; at += 1000) {
          await s3.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: keys.slice(at, at + 1000).map(({ key }) => ({ Key: key })) },
            }),
          );
        }
      }
      // Closing the app ends the pool (DatabaseModule lifecycle), so drop the schema first.
      await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
      await app.close();
    },
  };
}

function verifier(jwk: JWK, keycloakIssuerUrl: string | undefined): Pick<TokenVerifier, 'verify'> {
  const local = new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] }));
  if (!keycloakIssuerUrl) return local;
  const keycloak = new TokenVerifier(keycloakIssuerUrl, AUDIENCE);
  return { verify: (token) => local.verify(token).catch(() => keycloak.verify(token)) };
}

function testS3Client(): S3Client {
  return new S3Client({
    endpoint: requireEnv('TEST_S3_ENDPOINT'),
    region: requireEnv('S3_REGION'),
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
  });
}

/** Applies the committed migrations in journal order inside the private schema. */
async function applyMigrations(db: Database<DocumentsSchema>): Promise<void> {
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', MIGRATIONS), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const { tag } of journal.entries) {
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
    scope,
    azp = 'console',
  }: Caller) =>
    new SignJWT({ azp, tenant, realm_access: { roles }, ...(scope ? { scope } : {}) })
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
