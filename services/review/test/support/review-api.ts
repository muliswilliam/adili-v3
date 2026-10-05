import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

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
import { FakeCipher, truncateTables } from '@adili/data-access/testing';
import { type EventEnvelope, OutboxRelay } from '@adili/events';
import { TemporalWorkerReadinessCheck, WorkflowBundler } from '@adili/temporal';
import { prebuiltWorkflowBundler, untilWorkerPolling } from '@adili/temporal/testing';
import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { v7 as uuidv7 } from 'uuid';
import { inject } from 'vitest';

import { AiGatewayClient } from '../../src/ai-gateway/ai-gateway-client.js';
import { AppModule } from '../../src/app.module.js';
import type { ReviewTransaction } from '../../src/cases/case-lookup.js';
import { Clock } from '../../src/clock.js';
import { AiJobConsumer } from '../../src/copilot/ai-job.consumer.js';
import { AiPolicyConsumer } from '../../src/copilot/ai-policy.consumer.js';
import { CopilotActivities } from '../../src/copilot/activities.js';
import { type ReviewSchema, schema } from '../../src/db/schema.js';
import { DeclarationsClient } from '../../src/declarations/declarations-client.js';
import { DirectoryClient } from '../../src/directory/directory-client.js';
import {
  DocumentsClient,
  type IssueDocumentRequest,
} from '../../src/documents/documents-client.js';
import { EnforcementConsumer } from '../../src/enforcement/enforcement.consumer.js';
import { IntegrationGatewayClient } from '../../src/integration-gateway/integration-gateway-client.js';
import { NotificationsClient } from '../../src/notifications/notifications-client.js';
import { ProcessingActivities } from '../../src/processing/activities.js';
import { DeclarationSubmittedConsumer } from '../../src/processing/declaration-submitted.consumer.js';
import { ReferralIcmsRegisteredConsumer } from '../../src/referrals/icms-registered.consumer.js';
import { FakeAiGateway } from './fake-ai-gateway.js';
import { FakeClock } from './fake-clock.js';
import { FakeDeclarations } from './fake-declarations.js';
import { FakeDirectory } from './fake-directory.js';
import { FakeDocuments } from './fake-documents.js';
import { FakeIntegrationGateway } from './fake-integration-gateway.js';
import { FakeNotifications } from './fake-notifications.js';
import { applyMigrations } from './migrations.js';

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';

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
  /** The integration-gateway's payroll instructions. */
  gateway: FakeIntegrationGateway;
  clock: FakeClock;
  /** The ai-gateway's tasks and jobs (spec 07c). */
  ai: FakeAiGateway;
  /** The field cipher (real encryption, keys derived from the tenant). */
  cipher: FakeCipher;
  /** The inbox consumer of the `ai.job.*` events. */
  aiJobs: AiJobConsumer;
  aiPolicy: AiPolicyConsumer;
  /** The copilot's activities, for driving its steps directly. */
  copilot: CopilotActivities;
  /** The inbox consumer of `declaration.submitted.v1`, called as the RabbitMQ transport would. */
  consumer: DeclarationSubmittedConsumer;
  /** The inbox consumers of the obligation and clarification events that drive the ladder. */
  enforcement: EnforcementConsumer;
  /** The inbox consumer of `referral.icms-registered.v1` (spec 09's ICMS case number). */
  icmsRegistered: ReferralIcmsRegisteredConsumer;
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

/** Every table of the service, which `reset` empties. */
const TABLES = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table));

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
  const gateway = new FakeIntegrationGateway();
  const clock = new FakeClock();
  const ai = new FakeAiGateway();
  const cipher = new FakeCipher();
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
    .overrideProvider(IntegrationGatewayClient)
    .useValue(gateway)
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(AiGatewayClient)
    .useValue(ai)
    .overrideProvider(FieldCipher)
    .useValue(cipher)
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

  // The documents service pulls a document's fields with its own service token (review:internal).
  documents.payloadSource = async (tenant, letter) => {
    const token = await signer({ sub: 'service-account-documents', scopes: ['review:internal'] });
    const response = await app.inject({
      method: 'GET',
      url: letterPayloadPath(letter),
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
    gateway,
    clock,
    ai,
    cipher,
    aiJobs: app.get(AiJobConsumer),
    aiPolicy: app.get(AiPolicyConsumer),
    copilot: app.get(CopilotActivities),
    consumer: app.get(DeclarationSubmittedConsumer),
    enforcement: app.get(EnforcementConsumer),
    icmsRegistered: app.get(ReferralIcmsRegisteredConsumer),
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
      // A letter activity of the previous test may still hold a row lock while the fake documents
      // service pulls its payload over HTTP. That read would queue behind a waiting truncate, which
      // waits for the lock: a wait Postgres cannot see as a deadlock (see `close`). So the truncate
      // gives up after a moment, letting the read and the activity finish, and tries again. An
      // activity that locked a later table and then reads one the truncate already holds is a
      // deadlock Postgres does see; when it breaks one by aborting the truncate, that too is tried
      // again.
      await truncateTables(db, TABLES);
      declarations.reset();
      directory.reset();
      documents.reset();
      notifications.reset();
      gateway.reset();
      clock.reset();
      ai.reset();
      cipher.calls.length = 0;
      cipher.unavailable = false;
    },
    async close() {
      // Close the app first: its worker drains in-flight activities while the pool and the HTTP
      // routes they call back into still work. Dropping the schema under a running activity can
      // hang for good: the decision letter activity holds a row lock while the fake documents
      // service pulls the payload over HTTP, and that read queues behind the drop, which waits
      // for the lock (a wait Postgres cannot see as a deadlock). Closing the app ends the pool
      // (DatabaseModule lifecycle), so the drop takes a connection of its own.
      await app.close();
      const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'review-test' });
      try {
        await admin.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
      } finally {
        await admin.$client.end();
      }
    },
  };
}

/** Where the documents service pulls a document's fields from. */
function letterPayloadPath(letter: IssueDocumentRequest): string {
  switch (letter.type) {
    case 'referral-package':
      return `/internal/v1/review/referrals/${letter.payload.referralId}/package-payload`;
    case 'clarification-letter':
      return `/internal/v1/review/clarifications/${letter.payload.clarificationId}/letter-payload`;
    case 'decision-letter':
      return `/internal/v1/review/determinations/${letter.payload.determinationId}/letter-payload`;
    default:
      return `/internal/v1/review/actions/${letter.payload.actionId}/letter-payload`;
  }
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
