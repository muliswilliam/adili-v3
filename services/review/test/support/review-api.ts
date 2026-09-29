import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier } from '@adili/api-kit';
import { createDatabase, DATABASE, type Database, withTenant } from '@adili/data-access';
import { type EventEnvelope, OutboxRelay } from '@adili/events';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { v7 as uuidv7 } from 'uuid';

import { AppModule } from '../../src/app.module.js';
import type { ReviewTransaction } from '../../src/cases/case-lookup.js';
import { Clock } from '../../src/clock.js';
import { type ReviewSchema, schema } from '../../src/db/schema.js';
import { DeclarationsClient } from '../../src/declarations/declarations-client.js';
import { DirectoryClient } from '../../src/directory/directory-client.js';
import { DocumentsClient } from '../../src/documents/documents-client.js';
import { NotificationsClient } from '../../src/notifications/notifications-client.js';
import { ProcessingActivities } from '../../src/processing/activities.js';
import { DeclarationSubmittedConsumer } from '../../src/processing/declaration-submitted.consumer.js';
import { FakeClock } from './fake-clock.js';
import { FakeDeclarations } from './fake-declarations.js';
import { FakeDirectory } from './fake-directory.js';
import { FakeDocuments } from './fake-documents.js';
import { FakeNotifications } from './fake-notifications.js';

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';
const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export interface Caller {
  sub?: string;
  tenant?: string | null;
  roles?: string[];
  name?: string;
  /** The `person_id` claim of an onboarded declarant's token; absent by default. */
  personId?: string;
  /** OAuth scopes (`scope`), as service tokens carry them. */
  scopes?: string[];
}

export interface ReviewApi {
  app: NestFastifyApplication;
  /**
   * Direct database access for arranging fixtures and reading rows the API does not show. Tables
   * are under FORCE row-level security: use `asPlatform` to see every tenant's rows.
   */
  db: Database<ReviewSchema>;
  asPlatform<T>(work: (tx: ReviewTransaction) => Promise<T>): Promise<T>;
  declarations: FakeDeclarations;
  directory: FakeDirectory;
  /** Documents; each letter issued pulls its payload from this app's internal endpoint. */
  documents: FakeDocuments;
  notifications: FakeNotifications;
  clock: FakeClock;
  /** The inbox consumer of `declaration.submitted.v1`, called as the RabbitMQ transport would. */
  consumer: DeclarationSubmittedConsumer;
  /** The processing workflow's activities, for driving its steps directly. */
  activities: ProcessingActivities;
  get(
    url: string,
    caller: Caller,
    headers?: Record<string, string>,
  ): ReturnType<NestFastifyApplication['inject']>;
  /** A request with a JSON body (when given) as `caller`. */
  send(
    method: 'POST' | 'PUT',
    url: string,
    caller: Caller,
    body?: unknown,
    headers?: Record<string, string>,
  ): ReturnType<NestFastifyApplication['inject']>;
  /** Empties every table. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The review service over HTTP and at its event inbox, against a real Postgres
 * (`TEST_DATABASE_URL`) with a private schema per suite and the committed migrations applied.
 * Declarations and the directory are fakes, tokens are signed locally and the outbox relay is off
 * (events stay in the outbox for assertions). Workflows run on the compose Temporal through the
 * service's own worker, polling the suite's own task queue (test/support/temporal-task-queue.ts).
 * The test role owns the tables, so FORCE row-level security applies to it as to the service's.
 */
export async function startReviewApi(): Promise<ReviewApi> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const pgSchema = `review_test_${String(process.pid)}_${randomUUID().slice(0, 8)}`;
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);

  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'review-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();

  const db = createDatabase({ url: url.toString(), schema, applicationName: 'review-test' });
  await applyMigrations(db);

  const { signer, jwk } = await tokenSigner();
  const declarations = new FakeDeclarations();
  const directory = new FakeDirectory();
  const documents = new FakeDocuments();
  const notifications = new FakeNotifications();
  const clock = new FakeClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] })))
    .overrideProvider(DeclarationsClient)
    .useValue(declarations)
    .overrideProvider(DirectoryClient)
    .useValue(directory)
    .overrideProvider(DocumentsClient)
    .useValue(documents)
    .overrideProvider(NotificationsClient)
    .useValue(notifications)
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(OutboxRelay)
    .useValue({})
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: ['fatal'],
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  // The documents service pulls a letter's fields with its own service token (review:internal).
  documents.payloadSource = async (tenant, letter) => {
    const token = await signer({ sub: 'service-account-documents', scopes: ['review:internal'] });
    const response = await app.inject({
      method: 'GET',
      url:
        letter.type === 'clarification-letter'
          ? `/internal/v1/review/clarifications/${letter.payload.clarificationId}/letter-payload`
          : `/internal/v1/review/determinations/${letter.payload.determinationId}/letter-payload`,
      headers: { authorization: `Bearer ${token}`, 'x-acting-tenant': tenant },
    });
    return { status: response.statusCode, body: response.json<unknown>() };
  };

  return {
    app,
    db,
    asPlatform: (work) => withTenant(db, { tenant: 'platform', subject: 'test' }, work),
    declarations,
    directory,
    documents,
    notifications,
    clock,
    consumer: app.get(DeclarationSubmittedConsumer),
    activities: app.get(ProcessingActivities),
    async get(path, caller, headers = {}) {
      const token = await signer(caller);
      return app.inject({
        method: 'GET',
        url: path,
        headers: { ...headers, authorization: `Bearer ${token}` },
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
      await db.execute(
        sql`truncate closure_sweeps, bulk_approvals, approval_reassignments, determinations, clarification_responses, clarifications, review_assignments, review_flags, review_notes, review_timeline, review_case_versions, review_cases, outbox, inbox, numbering_counters, idempotency_keys`,
      );
      declarations.reset();
      directory.reset();
      documents.reset();
      notifications.reset();
      clock.reset();
    },
    async close() {
      // Closing the app ends the pool (DatabaseModule lifecycle), so drop the schema first.
      await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
      await app.close();
    },
  };
}

/** `declaration.submitted.v1` for a version, as the RabbitMQ transport delivers it. */
export function submittedEvent(
  tenant: string,
  version: { declarationId: string; versionId: string; version: number },
): EventEnvelope {
  return {
    specversion: '1.0',
    id: uuidv7(),
    source: 'adili/declarations',
    type: 'declaration.submitted.v1',
    time: new Date().toISOString(),
    subject: version.declarationId,
    datacontenttype: 'application/json',
    tenant,
    data: {
      declarationId: version.declarationId,
      versionId: version.versionId,
      version: version.version,
      reference: 'DEC-PSC-2027-0000001-7',
      type: 'biennial',
      statementDate: '2027-11-01',
      obligationId: randomUUID(),
      amendment: version.version > 1,
      late: false,
    },
  };
}

async function applyMigrations(db: Database<ReviewSchema>): Promise<void> {
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
      azp: 'console',
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
