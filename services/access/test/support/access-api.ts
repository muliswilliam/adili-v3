import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PLATFORM_TENANT, TokenVerifier } from '@adili/api-kit';
import {
  createDatabase,
  DATABASE,
  FieldCipher,
  type TenantContext,
  withPerson,
  withTenant,
} from '@adili/data-access';
import { FakeCipher } from '@adili/data-access/testing';
import { OutboxRelay } from '@adili/events';
import { TEMPORAL_CLIENT, TemporalWorkerReadinessCheck, WorkflowBundler } from '@adili/temporal';
import { prebuiltWorkflowBundler, untilWorkerPolling } from '@adili/temporal/testing';
import type { Client } from '@temporalio/client';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { inject } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/clock.js';
import type { AccessDatabase, AccessTransaction } from '../../src/db/database.js';
import { schema } from '../../src/db/schema.js';
import { DeclarationsClient } from '../../src/declarations/declarations-client.js';
import { ReviewClient } from '../../src/review/review-client.js';
import { DirectoryClient } from '../../src/directory/directory-client.js';
import { DocumentsClient } from '../../src/documents/documents-client.js';
import { leaRequestWorkflowId } from '../../src/lea/contract.js';
import { onboardedNoticeWorkflowId } from '../../src/onboarded-notices/contract.js';
import { accessRequestWorkflowId } from '../../src/requests/contract.js';
import { certifiedCopyWorkflowId } from '../../src/self-access/contract.js';
import { NotificationsClient } from '../../src/notifications/notifications-client.js';
import { FakeClock } from './fake-clock.js';
import {
  FakeDeclarations,
  FakeDirectory,
  FakeDocuments,
  FakeNotifications,
  FakeReview,
} from './fakes.js';

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';
const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export interface Caller {
  sub?: string;
  tenant?: string | null;
  roles?: string[];
  name?: string;
  /** The `person_id` claim of an applicant's or declarant's token; absent by default. */
  personId?: string;
  /** OAuth scopes (`scope`), as service tokens carry them. */
  scopes?: string[];
}

/** An event the service recorded in its outbox. */
export interface RecordedEvent {
  type: string;
  tenant?: string;
  subject?: string;
  data: Record<string, unknown>;
}

export interface AccessApi {
  app: NestFastifyApplication;
  /**
   * Direct database access for arranging fixtures and reading rows the API does not show. Tables
   * are under FORCE row-level security: use `asPlatform` to see every tenant's rows.
   */
  db: AccessDatabase;
  /** The suite's own Postgres schema, for test-only objects (e.g. a failing trigger). */
  pgSchema: string;
  asPlatform<T>(work: (tx: AccessTransaction) => Promise<T>): Promise<T>;
  asTenant<T>(context: TenantContext, work: (tx: AccessTransaction) => Promise<T>): Promise<T>;
  asPerson<T>(personId: string, work: (tx: AccessTransaction) => Promise<T>): Promise<T>;
  directory: FakeDirectory;
  declarations: FakeDeclarations;
  review: FakeReview;
  documents: FakeDocuments;
  notifications: FakeNotifications;
  cipher: FakeCipher;
  clock: FakeClock;
  /** The Temporal client the service starts workflows with. */
  temporal: Client;
  /** The events recorded in the outbox, of `type` when given, oldest first. */
  events(type?: string): Promise<RecordedEvent[]>;
  /** Terminates the workflows with these ids; one not running is fine. */
  endWorkflows(ids: readonly string[]): Promise<void>;
  /**
   * Waits until `check` holds (or returns a value other than undefined), as a workflow's
   * activities make it so; fails after `timeoutMs`.
   */
  eventually<T>(
    check: () => T | undefined | false | Promise<T | undefined | false>,
    timeoutMs?: number,
  ): Promise<T>;
  get(url: string, caller: Caller): ReturnType<NestFastifyApplication['inject']>;
  /** A request with a JSON body (when given) and extra headers as `caller`. */
  send(
    method: 'POST' | 'PUT',
    url: string,
    caller: Caller,
    body?: unknown,
    headers?: Record<string, string>,
  ): ReturnType<NestFastifyApplication['inject']>;
  /** Empties every table and forgets what the fakes were given. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The access service over HTTP, against a real Postgres (`TEST_DATABASE_URL`) with a private
 * schema per suite and the committed migrations applied. The directory, declarations, review,
 * documents and notifications are fakes, the cipher is the in-memory one, tokens are signed locally and the
 * outbox relay is off (events stay in the outbox for assertions). Workflows run on the compose
 * Temporal through the service's own worker, polling the suite's own task queue
 * (test/support/temporal-task-queue.ts). The test role owns the tables, so FORCE row-level
 * security applies to it as to the service's.
 */
export async function startAccessApi(): Promise<AccessApi> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const pgSchema = `access_test_${String(process.pid)}_${randomUUID().slice(0, 8)}`;
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);

  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'access-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();

  const db = createDatabase({ url: url.toString(), schema, applicationName: 'access-test' });
  await applyMigrations(db);

  const { signer, jwk } = await tokenSigner();
  const directory = new FakeDirectory();
  const declarations = new FakeDeclarations();
  const review = new FakeReview();
  const clock = new FakeClock();
  const documents = new FakeDocuments(() => clock.now());
  const notifications = new FakeNotifications();
  const cipher = new FakeCipher();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] })))
    .overrideProvider(DirectoryClient)
    .useValue(directory)
    .overrideProvider(DeclarationsClient)
    .useValue(declarations)
    .overrideProvider(ReviewClient)
    .useValue(review)
    .overrideProvider(DocumentsClient)
    .useValue(documents)
    .overrideProvider(NotificationsClient)
    .useValue(notifications)
    .overrideProvider(FieldCipher)
    .useValue(cipher)
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(OutboxRelay)
    .useValue({})
    .overrideProvider(WorkflowBundler)
    .useValue(prebuiltWorkflowBundler(inject('workflowBundles')))
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: ['fatal'],
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  // Tests start once the worker polls, as traffic waits for readiness (see untilWorkerPolling).
  await untilWorkerPolling(app.get(TemporalWorkerReadinessCheck));

  const temporal = app.get<Client>(TEMPORAL_CLIENT);
  return {
    app,
    db,
    pgSchema,
    asPlatform: (work) => withTenant(db, { tenant: PLATFORM_TENANT, subject: 'test' }, work),
    asTenant: (context, work) => withTenant(db, context, work),
    asPerson: (personId, work) => withPerson(db, { personId, subject: 'test' }, work),
    directory,
    declarations,
    review,
    documents,
    notifications,
    cipher,
    clock,
    temporal,
    async events(type) {
      const rows = await db.select().from(schema.outbox).orderBy(schema.outbox.id);
      return rows
        .map((row) => row.envelope as RecordedEvent)
        .filter((event) => type === undefined || event.type === type);
    },
    async endWorkflows(ids) {
      for (const id of ids) {
        try {
          await temporal.workflow.getHandle(id).terminate();
        } catch {
          // Not running.
        }
      }
    },
    async eventually(check, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const value = await check();
        if (value !== undefined && value !== false) return value;
        if (Date.now() > deadline) throw new Error('Timed out waiting for the workflow');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    async get(path, caller) {
      const token = await signer(caller);
      return app.inject({
        method: 'GET',
        url: path,
        headers: { authorization: `Bearer ${token}` },
      });
    },
    async send(method, path, caller, body, headers = {}) {
      const token = await signer(caller);
      return app.inject({
        method,
        url: path,
        headers: { ...headers, authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { payload: body as object }),
      });
    },
    async reset() {
      // The suite's requests' workflows end first, so none acts on the next test's rows.
      const { requests, copies, leaRows } = await withTenant(
        db,
        { tenant: PLATFORM_TENANT, subject: 'test' },
        async (tx) => ({
          requests: await tx.select({ id: schema.accessRequests.id }).from(schema.accessRequests),
          copies: await tx.select({ id: schema.certifiedCopies.id }).from(schema.certifiedCopies),
          leaRows: await tx.select({ id: schema.leaRequests.id }).from(schema.leaRequests),
        }),
      );
      const workflowIds = [
        ...requests.map(({ id }) => accessRequestWorkflowId(id)),
        ...copies.map(({ id }) => certifiedCopyWorkflowId(id)),
        ...leaRows.map(({ id }) => leaRequestWorkflowId(id)),
        ...[...requests, ...leaRows].map(({ id }) => onboardedNoticeWorkflowId(id)),
      ];
      for (const id of workflowIds) {
        try {
          await temporal.workflow.getHandle(id).terminate();
        } catch {
          // Never started (held), or ended already.
        }
      }
      // Children before parents; the register's insert-only trigger does not fire on truncate.
      await db.execute(
        sql`truncate representations, access_requests, lea_requests, access_register, certified_copies, self_access_applications, numbering_counters, idempotency_keys, outbox, inbox`,
      );
      directory.reset();
      declarations.reset();
      review.reset();
      documents.reset();
      notifications.reset();
      cipher.calls.length = 0;
      cipher.unavailable = false;
      clock.reset();
    },
    async close() {
      // Closing the app ends the pool (DatabaseModule lifecycle), so drop the schema first.
      await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
      await app.close();
    },
  };
}

async function applyMigrations(db: AccessDatabase): Promise<void> {
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
    personId,
    scopes,
  }: Caller) =>
    new SignJWT({
      azp: 'portal',
      tenant,
      realm_access: { roles },
      name,
      person_id: personId,
      scope: scopes?.join(' '),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(sub)
      .setExpirationTime('5m')
      .sign(privateKey);
  return { signer, jwk };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see vitest.integration.config.ts`);
  return value;
}
