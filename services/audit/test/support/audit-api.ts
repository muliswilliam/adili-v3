import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier, TRUSTED_PROXIES_DEFAULT } from '@adili/api-kit';
import { createDatabase, DATABASE, type Database } from '@adili/data-access';
import { type EventEnvelope, OutboxRelay } from '@adili/events';
import { TEMPORAL_CLIENT, TemporalWorkerReadinessCheck, WorkflowBundler } from '@adili/temporal';
import { prebuiltWorkflowBundler, untilWorkerPolling } from '@adili/temporal/testing';
import type { Client } from '@temporalio/client';
import { asc, sql } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { inject } from 'vitest';

import { AnchorArchive } from '../../src/anchoring/archive.js';
import { Anchoring } from '../../src/anchoring/anchoring.js';
import { OpenBaoAnchorSigner } from '../../src/anchoring/openbao-signer.js';
import { AppModule } from '../../src/app.module.js';
import { type AuditSchema, outbox, schema } from '../../src/db/schema.js';
import { AuditTrail } from '../../src/trail/audit-trail.js';
import { IngestConsumer } from '../../src/trail/ingest.consumer.js';
import { FakeArchive, FakeSigner } from './fakes.js';

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';
const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export interface Caller {
  sub?: string;
  tenant?: string | null;
  roles?: string[];
}

export const AUDITOR_CALLER: Caller = { sub: 'auditor-sub', tenant: 'eacc', roles: ['auditor'] };

export interface AuditApi {
  app: NestFastifyApplication;
  /** Direct database access, as the test role (which owns the tables) sees it. */
  db: Database<AuditSchema>;
  trail: AuditTrail;
  anchoring: Anchoring;
  archive: FakeArchive;
  temporal: Client;
  /** Delivers an event to the consumer as the RabbitMQ transport would. */
  deliver(event: unknown): Promise<void>;
  get(url: string, caller: Caller): ReturnType<NestFastifyApplication['inject']>;
  /** The events recorded in the outbox (the audit service's own audited reads), oldest first. */
  outbox(): Promise<EventEnvelope[]>;
  /** Runs SQL as the table owner with the append-only triggers off: a tamperer with DBA rights. */
  tamper(statement: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * The audit service over HTTP and at its event inbox, against a real Postgres
 * (`TEST_DATABASE_URL`) with a private schema per suite and the committed migrations applied.
 * Tokens are signed locally, the outbox relay is off, the anchors' signer and archive are fakes,
 * and workflows run on the compose Temporal through the service's own worker, polling the suite's
 * own task queue.
 */
export async function startAuditApi(): Promise<AuditApi> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const pgSchema = `audit_test_${String(process.pid)}_${randomUUID().slice(0, 8)}`;
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);

  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'audit-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();

  const db = createDatabase({ url: url.toString(), schema, applicationName: 'audit-test' });
  await applyMigrations(db);

  const { signer, jwk } = await tokenSigner();
  const archive = new FakeArchive();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] })))
    .overrideProvider(OpenBaoAnchorSigner)
    .useValue(new FakeSigner())
    .overrideProvider(AnchorArchive)
    .useValue(archive)
    .overrideProvider(OutboxRelay)
    .useValue({})
    .overrideProvider(WorkflowBundler)
    .useValue(prebuiltWorkflowBundler(inject('workflowBundles')))
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: TRUSTED_PROXIES_DEFAULT }),
    { logger: ['fatal'] },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await untilWorkerPolling(app.get(TemporalWorkerReadinessCheck));

  const consumer = app.get(IngestConsumer);
  return {
    app,
    db,
    trail: app.get(AuditTrail),
    anchoring: app.get(Anchoring),
    archive,
    temporal: app.get<Client>(TEMPORAL_CLIENT),
    deliver: (event) => consumer.ingest(event),
    async get(path, caller) {
      const token = await signer(caller);
      return app.inject({
        method: 'GET',
        url: path,
        headers: { authorization: `Bearer ${token}` },
      });
    },
    async outbox() {
      const rows = await db.select().from(outbox).orderBy(asc(outbox.id));
      return rows.map((row) => row.envelope);
    },
    async tamper(statement) {
      await db.transaction(async (tx) => {
        for (const table of ['audit_events', 'audit_chain_heads', 'audit_anchors']) {
          await tx.execute(sql.raw(`alter table ${table} disable trigger user`));
        }
        await tx.execute(sql.raw(statement));
        for (const table of ['audit_events', 'audit_chain_heads', 'audit_anchors']) {
          await tx.execute(sql.raw(`alter table ${table} enable trigger user`));
        }
      });
    },
    async close() {
      await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
      await app.close();
    },
  };
}

async function applyMigrations(db: Database<AuditSchema>): Promise<void> {
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
  const signer = ({ sub = randomUUID(), tenant = null, roles = [] }: Caller) =>
    new SignJWT({ azp: 'console', tenant, realm_access: { roles } })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(sub)
      .setExpirationTime('5m')
      .sign(privateKey);
  return { signer, jwk };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see vitest.integration.config.ts`);
  return value;
}
