import 'reflect-metadata';

import { Controller, Module } from '@nestjs/common';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { Payload } from '@nestjs/microservices';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createDatabase, type Database, DATABASE, DatabaseModule } from '@adili/data-access';
import { readFileSync } from 'node:fs';

import amqp from 'amqplib';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  deadLetterQueue,
  type EventEnvelope,
  EventPublisher,
  EventsModule,
  eventsQueue,
  eventsSchema,
  eventsServerOptions,
  OnEvent,
  outbox,
} from '../src/index.js';

/**
 * Exercises the real path against Postgres and RabbitMQ (`pnpm infra:up`):
 * outbox row -> relay -> topic exchange -> service queue -> @OnEvent handler, and
 * a failing handler -> one redelivery -> dead-letter queue.
 *
 * Runs can overlap (other suites, other checkouts) on the shared test database and broker, so
 * each run has a private Postgres schema and its own event types: another run's relay or
 * events never reach this one.
 */
const RUN = Array.from({ length: 8 }, () =>
  String.fromCharCode(97 + Math.floor(Math.random() * 26)),
).join('');
const SCHEMA = `events_test_${RUN}`;
const DATABASE_URL = withSearchPath(requireEnv('TEST_DATABASE_URL'), SCHEMA);
const RABBITMQ_URL = requireEnv('TEST_RABBITMQ_URL');
const SERVICE = `events-test-${RUN}`;
const HAPPENED = `test.happened-${RUN}.v1`;
const BROKEN = `test.broken-${RUN}.v1`;

const received: EventEnvelope[] = [];
let failures = 0;

@Controller()
class TestConsumer {
  @OnEvent(HAPPENED)
  happened(@Payload() event: EventEnvelope) {
    received.push(event);
  }

  @OnEvent(BROKEN)
  broken() {
    failures++;
    throw new Error('handler bug');
  }
}

@Module({
  imports: [
    DatabaseModule.forRoot({ url: DATABASE_URL, schema: eventsSchema, applicationName: SERVICE }),
    EventsModule.forRoot({ service: SERVICE, rabbitmqUrl: RABBITMQ_URL }),
  ],
  controllers: [TestConsumer],
})
class TestAppModule {}

describe('outbox to consumer over RabbitMQ', () => {
  let app: NestFastifyApplication;
  let db: Database<typeof eventsSchema>;
  let publisher: EventPublisher;

  beforeAll(async () => {
    await resetTables();
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.connectMicroservice<MicroserviceOptions>(
      eventsServerOptions({ service: SERVICE, rabbitmqUrl: RABBITMQ_URL }),
    );
    await app.startAllMicroservices();
    await app.init();
    db = app.get(DATABASE);
    publisher = app.get(EventPublisher);
  });

  afterAll(async () => {
    await app.close();
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.deleteQueue(eventsQueue(SERVICE));
    await channel.deleteQueue(deadLetterQueue(SERVICE));
    await connection.close();
    await dropSchema();
  });

  it('delivers an event recorded in a committed transaction', async () => {
    const envelope = await db.transaction((tx) =>
      publisher.record(tx, {
        type: HAPPENED,
        subject: 'DCB-TSC-2027-0012345-K',
        tenant: 'tsc',
        data: { declarationId: 'd-1' },
      }),
    );

    await waitFor(() => received.some((event) => event.id === envelope.id));
    expect(received.find((event) => event.id === envelope.id)).toEqual(envelope);

    // The relay marks the row after the broker confirms, so the consumer can see the event first.
    await waitFor(async () => {
      const [row] = await db.select().from(outbox).where(eq(outbox.id, envelope.id));
      return row?.publishedAt instanceof Date;
    });
  });

  it('does not publish events from a rolled-back transaction', async () => {
    let recordedId = '';
    await expect(
      db.transaction(async (tx) => {
        recordedId = (await publisher.record(tx, { type: HAPPENED, data: {} })).id;
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');

    const rows = await db.select().from(outbox).where(eq(outbox.id, recordedId));
    expect(rows).toHaveLength(0);
  });

  it('retries a failing handler once, then dead-letters the message', async () => {
    const envelope = await db.transaction((tx) => publisher.record(tx, { type: BROKEN, data: {} }));

    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    let deadLettered: amqp.GetMessage | false = false;
    await waitFor(async () => {
      deadLettered = await channel.get(deadLetterQueue(SERVICE), { noAck: true });
      return deadLettered !== false;
    });
    await connection.close();

    expect(failures).toBe(2);
    const message = deadLettered as unknown as amqp.GetMessage;
    const packet = JSON.parse(message.content.toString()) as { data: EventEnvelope };
    expect(packet.data.id).toBe(envelope.id);
  });
});

/** Creates the run's private schema with the events tables (migrations applied directly). */
async function resetTables(): Promise<void> {
  const setup = createDatabase({ url: DATABASE_URL, schema: {}, applicationName: SERVICE });
  await setup.execute(sql.raw(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}`));
  const migrations = new URL('migrations/', import.meta.url);
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', migrations), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const { tag } of journal.entries) {
    const migration = readFileSync(new URL(`${tag}.sql`, migrations), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await setup.execute(sql.raw(statement));
    }
  }
  await setup.$client.end();
}

async function dropSchema(): Promise<void> {
  const setup = createDatabase({ url: DATABASE_URL, schema: {}, applicationName: SERVICE });
  await setup.execute(sql.raw(`drop schema if exists ${SCHEMA} cascade`));
  await setup.$client.end();
}

function withSearchPath(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see vitest.integration.config.ts`);
  return value;
}
