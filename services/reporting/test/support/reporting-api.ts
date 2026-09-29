import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier } from '@adili/api-kit';
import {
  createDatabase,
  DATABASE,
  type Database,
  FieldCipher,
  withTenant,
} from '@adili/data-access';
import { FakeCipher } from '@adili/data-access/testing';
import { type EventEnvelope, OutboxRelay } from '@adili/events';
import { TEMPORAL_CLIENT, TemporalWorkerReadinessCheck } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { vi } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/clock.js';
import { ComplianceReportActivities } from '../../src/compliance-reports/activities.js';
import type { ReportingTransaction } from '../../src/compliance-reports/reports.js';
import { type ReportingSchema, schema } from '../../src/db/schema.js';
import { DeclarationsClient } from '../../src/declarations/declarations-client.js';
import { DirectoryClient } from '../../src/directory/directory-client.js';
import { DocumentsClient } from '../../src/documents/documents-client.js';
import { NotificationsClient } from '../../src/notifications/notifications-client.js';
import { ProjectionsConsumer } from '../../src/projections/projections.consumer.js';
import { ReviewClient } from '../../src/review/review-client.js';
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
  /** OAuth scopes (`scope`), as service tokens carry them. */
  scopes?: string[];
  /** Level of authentication (`acr`), e.g. `step-up` after re-authentication. */
  acr?: string;
  /** When the user authenticated (`auth_time`), an ISO instant. */
  authTime?: string;
}

export interface ReportingApi {
  app: NestFastifyApplication;
  /**
   * Direct database access for arranging fixtures and reading rows the API does not show. Tables
   * are under FORCE row-level security: use `asPlatform` to see every tenant's rows.
   */
  db: Database<ReportingSchema>;
  asPlatform<T>(work: (tx: ReportingTransaction) => Promise<T>): Promise<T>;
  declarations: FakeDeclarations;
  review: FakeReview;
  directory: FakeDirectory;
  notifications: FakeNotifications;
  documents: FakeDocuments;
  cipher: FakeCipher;
  clock: FakeClock;
  /** The Temporal client the service starts workflows with. */
  temporal: Client;
  /** The inbox consumers of the projected events. */
  consumer: ProjectionsConsumer;
  /** The compile workflow's activities, for driving its steps directly. */
  activities: ComplianceReportActivities;
  /** Delivers an event to its consumer as the RabbitMQ transport would; false for a redelivery. */
  deliver(event: EventEnvelope): Promise<boolean>;
  get(url: string, caller: Caller): ReturnType<NestFastifyApplication['inject']>;
  /** A request with a JSON body (when given) and extra headers as `caller`. */
  send(
    method: 'POST' | 'PATCH',
    url: string,
    caller: Caller,
    body?: unknown,
    headers?: Record<string, string>,
  ): ReturnType<NestFastifyApplication['inject']>;
  /** Empties every table and forgets what the fakes were given. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** The consumer method of each projected event type. */
const HANDLERS: Record<string, keyof ProjectionsConsumer> = {
  'obligation.created.v1': 'obligationCreated',
  'obligation.status-changed.v1': 'obligationStatusChanged',
  'declaration.submitted.v1': 'declarationSubmitted',
  'clarification.issued.v1': 'clarificationIssued',
  'clarification.responded.v1': 'clarificationResponded',
  'clarification.resolved.v1': 'clarificationResolved',
  'clarification.overdue.v1': 'clarificationOverdue',
  'clarification.withdrawn.v1': 'clarificationWithdrawn',
  'action.proposed.v1': 'actionProposed',
  'action.approved.v1': 'actionApproved',
  'action.declined.v1': 'actionDeclined',
  'action.issued.v1': 'actionIssued',
  'action.responded.v1': 'actionResponded',
  'action.complied.v1': 'actionComplied',
  'action.cancelled.v1': 'actionCancelled',
  'determination.approved.v1': 'determinationApproved',
  'referral.sent.v1': 'referralSent',
};

/**
 * The reporting service over HTTP and at its event inbox, against a real Postgres
 * (`TEST_DATABASE_URL`) with a private schema per suite and the committed migrations applied.
 * Declarations, review, the directory and notifications are fakes, the cipher is the in-memory
 * one, tokens are signed locally and the outbox relay is off (events stay in the outbox for
 * assertions). Workflows run on the compose Temporal through the service's own worker, polling
 * the suite's own task queue (test/support/temporal-task-queue.ts). The test role owns the
 * tables, so FORCE row-level security applies to it as to the service's.
 */
export async function startReportingApi(): Promise<ReportingApi> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const pgSchema = `reporting_test_${String(process.pid)}_${randomUUID().slice(0, 8)}`;
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);

  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'reporting-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();

  const db = createDatabase({ url: url.toString(), schema, applicationName: 'reporting-test' });
  await applyMigrations(db);

  const { signer, jwk } = await tokenSigner();
  const declarations = new FakeDeclarations();
  const review = new FakeReview();
  const directory = new FakeDirectory();
  const notifications = new FakeNotifications();
  const documents = new FakeDocuments();
  const cipher = new FakeCipher();
  const clock = new FakeClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] })))
    .overrideProvider(DeclarationsClient)
    .useValue(declarations)
    .overrideProvider(ReviewClient)
    .useValue(review)
    .overrideProvider(DirectoryClient)
    .useValue(directory)
    .overrideProvider(NotificationsClient)
    .useValue(notifications)
    .overrideProvider(DocumentsClient)
    .useValue(documents)
    .overrideProvider(FieldCipher)
    .useValue(cipher)
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
  // The worker bundles the workflow code before it polls: seconds of CPU, longer when suites
  // start together. Tests begin once it polls, so their waits measure the workflow alone.
  const worker = app.get(TemporalWorkerReadinessCheck);
  await vi.waitFor(() => worker.check(), { timeout: 120_000, interval: 250 });

  const consumer = app.get(ProjectionsConsumer);
  return {
    app,
    db,
    asPlatform: (work) => withTenant(db, { tenant: 'platform', subject: 'test' }, work),
    declarations,
    review,
    directory,
    notifications,
    documents,
    cipher,
    clock,
    temporal: app.get<Client>(TEMPORAL_CLIENT),
    consumer,
    activities: app.get(ComplianceReportActivities),
    deliver(event) {
      const handler = HANDLERS[event.type];
      if (!handler) throw new Error(`No consumer for ${event.type}`);
      return consumer[handler].call(consumer, event);
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
      await db.execute(
        sql`truncate report_remarks, report_reminders, report_receipts, compliance_reports, obligation_facts, clarification_facts, action_facts, determination_facts, referral_facts, numbering_counters, idempotency_keys, outbox, inbox`,
      );
      declarations.reset();
      review.reset();
      directory.reset();
      notifications.reset();
      documents.reset();
      cipher.calls.length = 0;
      clock.reset();
    },
    async close() {
      // Closing the app ends the pool (DatabaseModule lifecycle), so drop the schema first.
      await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
      await app.close();
    },
  };
}

async function applyMigrations(db: Database<ReportingSchema>): Promise<void> {
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
    scopes,
    acr,
    authTime,
  }: Caller) =>
    new SignJWT({
      azp: 'console',
      tenant,
      realm_access: { roles },
      name,
      scope: scopes?.join(' '),
      acr,
      auth_time: authTime === undefined ? undefined : Math.floor(Date.parse(authTime) / 1000),
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
