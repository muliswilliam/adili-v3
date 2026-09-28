import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier } from '@adili/api-kit';
import { createDatabase, DATABASE, type Database } from '@adili/data-access';
import { type EventEnvelope, OutboxRelay } from '@adili/events';
import { TEMPORAL_CLIENT } from '@adili/temporal';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { v7 as uuidv7 } from 'uuid';

import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/clock.js';
import { type DeclarationsSchema, schema } from '../../src/db/schema.js';
import { DirectoryClient } from '../../src/directory/directory-client.js';
import { NotificationsClient } from '../../src/notifications/notifications-client.js';
import { RosterEventsConsumer } from '../../src/obligations/roster-events.consumer.js';
import { ObligationSteps } from '../../src/obligations/workflow/obligation-steps.js';
import { ObligationsSweep, SweepSchedule } from '../../src/obligations/workflow/sweep.js';
import { type ObligationChanges, ObligationWorkflows } from '../../src/obligations/workflows.js';
import { FakeDirectory } from './fake-directory.js';
import { FakeNotifications } from './fake-notifications.js';
import { FakeTemporal } from './fake-temporal.js';

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';
const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export interface Caller {
  sub?: string;
  tenant?: string | null;
  roles?: string[];
  /** The `person_id` claim of an onboarded declarant's token; absent by default. */
  personId?: string;
}

/** The clock the service computes "today" with; real time until a test sets it. */
export class TestClock extends Clock {
  private fixed: Date | undefined;

  now(): Date {
    return this.fixed ?? new Date();
  }

  /** Pins the time to noon in Nairobi on `date` (`YYYY-MM-DD`). */
  setToday(date: string): void {
    this.fixed = new Date(`${date}T12:00:00+03:00`);
  }

  reset(): void {
    this.fixed = undefined;
  }
}

/** Records what the obligations' workflows were told, standing in for Temporal. */
export class RecordingWorkflows extends ObligationWorkflows {
  readonly calls: { tenant: string; changes: ObligationChanges }[] = [];

  apply(tenant: string, changes: ObligationChanges): Promise<void> {
    this.calls.push({ tenant, changes });
    return Promise.resolve();
  }

  created(): string[] {
    return this.calls.flatMap((call) => call.changes.created);
  }

  cancelled(): ObligationChanges['cancelled'] {
    return this.calls.flatMap((call) => call.changes.cancelled);
  }

  personLinked(): string[] {
    return this.calls.flatMap((call) => call.changes.personLinked);
  }

  reset(): void {
    this.calls.length = 0;
  }
}

/**
 * How obligation workflows are started: `recording` (default) records what `ObligationWorkflows`
 * is told; `fake` runs the real `TemporalObligationWorkflows` against `FakeTemporal`; `real` uses
 * the compose Temporal, with the service's worker polling the suite's own task queue.
 */
export type WorkflowMode = 'recording' | 'fake' | 'real';

export interface DeclarationsApi {
  app: NestFastifyApplication;
  /** Direct database access for arranging fixtures and reading rows the API does not show. */
  db: Database<DeclarationsSchema>;
  directory: FakeDirectory;
  notifications: FakeNotifications;
  /** What `ObligationWorkflows` was told (`recording` mode only). */
  workflows: RecordingWorkflows;
  /** Starts and signals sent to Temporal (`fake` mode only). */
  temporal: FakeTemporal;
  /** The steps the workflow activities take. */
  steps: ObligationSteps;
  sweep: ObligationsSweep;
  clock: TestClock;
  /** The directory event consumers, called as the RabbitMQ transport would. */
  consumers: RosterEventsConsumer;
  /** `GET` as the given caller; returns Fastify's injected response. */
  get(url: string, caller: Caller): ReturnType<NestFastifyApplication['inject']>;
  /** `GET` without a bearer token. */
  anonymous(url: string): ReturnType<NestFastifyApplication['inject']>;
  /** Empties every table except seeded reference data. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The declarations service over HTTP and at its event inbox, against a real Postgres
 * (`TEST_DATABASE_URL`) with a private schema per suite and the committed migrations applied. The
 * directory is `FakeDirectory`, notifications `FakeNotifications`, workflows are recorded (see
 * `WorkflowMode`), tokens are signed locally and the outbox relay is off (events stay in the outbox
 * for assertions). The service's Temporal worker polls the suite's own task queue. The test role owns the tables, so
 * FORCE row-level security applies to it as to the service's role.
 */
export async function startDeclarationsApi({
  workflows: mode = 'recording',
}: { workflows?: WorkflowMode } = {}): Promise<DeclarationsApi> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const pgSchema = `declarations_test_${process.pid}_${randomUUID().slice(0, 8)}`;
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);

  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'declarations-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();

  const db = createDatabase({ url: url.toString(), schema, applicationName: 'declarations-test' });
  await applyMigrations(db);

  const { signer, jwk } = await tokenSigner();
  const directory = new FakeDirectory();
  const workflows = new RecordingWorkflows();
  const temporal = new FakeTemporal();
  const notifications = new FakeNotifications();
  const clock = new TestClock();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] })))
    .overrideProvider(DirectoryClient)
    .useValue(directory)
    .overrideProvider(NotificationsClient)
    .useValue(notifications)
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(OutboxRelay)
    .useValue({})
    // The hourly schedule lives on the shared Temporal; suites run the sweep themselves.
    .overrideProvider(SweepSchedule)
    .useValue({});
  if (mode === 'recording') {
    builder = builder.overrideProvider(ObligationWorkflows).useValue(workflows);
  } else if (mode === 'fake') {
    builder = builder.overrideProvider(TEMPORAL_CLIENT).useValue(temporal);
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
    directory,
    notifications,
    workflows,
    temporal,
    steps: app.get(ObligationSteps),
    sweep: app.get(ObligationsSweep),
    clock,
    consumers: app.get(RosterEventsConsumer),
    async get(path, caller) {
      const token = await signer(caller);
      return app.inject({
        method: 'GET',
        url: path,
        headers: { authorization: `Bearer ${token}` },
      });
    },
    anonymous(path) {
      return app.inject({ method: 'GET', url: path });
    },
    async reset() {
      await db.execute(
        sql`truncate obligation_reminders, filing_obligations, roster_snapshots, tenant_policy_cache, commission_refs, outbox, inbox`,
      );
      directory.reset();
      notifications.reset();
      workflows.reset();
      temporal.reset();
      clock.reset();
    },
    async close() {
      // Closing the app ends the pool (DatabaseModule lifecycle), so drop the schema first.
      await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
      await app.close();
    },
  };
}

/** A directory event as the RabbitMQ transport delivers it. */
export function directoryEvent(
  type: string,
  tenant: string,
  data: Record<string, unknown>,
): EventEnvelope {
  return {
    specversion: '1.0',
    id: uuidv7(),
    source: 'adili/directory',
    type,
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    tenant,
    data,
  };
}

async function applyMigrations(db: Database<DeclarationsSchema>): Promise<void> {
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
  const signer = ({ sub = randomUUID(), tenant = null, roles = [], personId }: Caller) =>
    new SignJWT({ azp: 'portal', tenant, realm_access: { roles }, person_id: personId })
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
