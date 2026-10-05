import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { RATE_LIMIT_CLOCK, TRUSTED_PROXIES_DEFAULT } from '@adili/api-kit';
import { createValkey, VALKEY } from '@adili/cache';
import { createDatabase, DATABASE, type Database } from '@adili/data-access';
import { type EventEnvelope, OutboxRelay } from '@adili/events';
import { asc, sql } from 'drizzle-orm';

import { AppModule } from '../../src/app.module.js';
import { outbox, schema, type VerificationSchema } from '../../src/db/schema.js';
import { ProjectionConsumer } from '../../src/verification/projection.consumer.js';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

/** The rate limiter's clock: real time until a test moves it on. */
export class TestClock {
  private offsetMs = 0;

  now(): number {
    return Date.now() + this.offsetMs;
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

export interface VerificationApi {
  app: NestFastifyApplication;
  /** Direct database access for reading what the API does not show (outbox, projection). */
  db: Database<VerificationSchema>;
  /** The issuance event consumers, called as the RabbitMQ transport would. */
  consumers: ProjectionConsumer;
  clock: TestClock;
  /** An anonymous `GET` from `ip` (a fresh address per call unless given). */
  get(path: string, ip?: string): Promise<InjectResponse>;
  /** The events recorded in the outbox, oldest first. */
  outbox(): Promise<EventEnvelope[]>;
  close(): Promise<void>;
}

/**
 * verification-api over HTTP against a real Postgres (`TEST_DATABASE_URL`) and Valkey
 * (`TEST_VALKEY_URL`, for the rate limiter). Each suite gets a private Postgres schema with the
 * service's migrations applied and its own Valkey key prefix, so budgets start fresh.
 */
export async function startVerificationApi(): Promise<VerificationApi> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const pgSchema = `verification_test_${process.pid}_${randomUUID().slice(0, 8)}`;
  const url = withSearchPath(baseUrl, pgSchema);

  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'verification-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();

  const db = createDatabase({ url, schema, applicationName: 'verification-test' });
  await applyMigrations(db);

  const clock = new TestClock();
  const valkey = createValkey({ url: requireEnv('TEST_VALKEY_URL'), keyPrefix: `${pgSchema}:` });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(VALKEY)
    .useValue(valkey)
    .overrideProvider(RATE_LIMIT_CLOCK)
    .useValue(() => clock.now())
    // Events stay in the outbox for `outbox()`: a live relay would publish them to the shared
    // broker.
    .overrideProvider(OutboxRelay)
    .useValue({})
    .compile();
  // Proxies trusted as `createService` trusts them: the client address is the socket's unless a
  // private-network proxy (the verify app's server) sends X-Forwarded-For.
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: TRUSTED_PROXIES_DEFAULT }),
    { logger: ['fatal'] },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    db,
    consumers: app.get(ProjectionConsumer),
    clock,
    get(path, ip = randomPublicIp()) {
      return app.inject({ method: 'GET', url: path, remoteAddress: ip });
    },
    async outbox() {
      const rows = await db.select().from(outbox).orderBy(asc(outbox.id));
      return rows.map((row) => row.envelope);
    },
    async close() {
      // Closing the app ends the pool (DatabaseModule lifecycle) and Valkey, so drop the schema
      // and this suite's keys first.
      await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
      const keys = await valkey.keys(`${pgSchema}:*`);
      if (keys.length > 0) {
        await valkey.del(...keys.map((key) => key.slice(`${pgSchema}:`.length)));
      }
      await app.close();
    },
  };
}

let addresses = 0;

/** A documentation-range address (RFC 5737), different on every call. */
export function randomPublicIp(): string {
  addresses += 1;
  return `203.0.${String(113 + Math.floor(addresses / 250))}.${String((addresses % 250) + 1)}`;
}

/** Applies the committed migrations in journal order inside the private schema. */
async function applyMigrations(db: Database<VerificationSchema>): Promise<void> {
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

function withSearchPath(databaseUrl: string, pgSchema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);
  return url.toString();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see vitest.integration.config.ts`);
  return value;
}
