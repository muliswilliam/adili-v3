import 'reflect-metadata';

import { Controller, Module } from '@nestjs/common';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { Payload } from '@nestjs/microservices';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { type Database, DATABASE, DatabaseModule } from '@adili/data-access';
import amqp from 'amqplib';
import { eq } from 'drizzle-orm';
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
import { privateSchema, requireEnv, runId } from './support/private-schema.js';

/**
 * Exercises the real path against Postgres and RabbitMQ (`pnpm infra:up`):
 * outbox row -> relay -> topic exchange -> service queue -> @OnEvent handler, and
 * a failing handler -> one redelivery -> dead-letter queue.
 *
 * Runs can overlap (other suites, other checkouts) on the shared test database and broker, so
 * each run has a private Postgres schema and its own event types: another run's relay or
 * events never reach this one.
 */
const RUN = runId();
const SERVICE = `events-test-${RUN}`;
const SCHEMA = privateSchema(`events_test_${RUN}`, SERVICE);
const DATABASE_URL = SCHEMA.url;
const RABBITMQ_URL = requireEnv('TEST_RABBITMQ_URL');
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
  let closed = false;

  beforeAll(async () => {
    await SCHEMA.create();
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
    if (!closed) await app.close();
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();
    await channel.deleteQueue(eventsQueue(SERVICE));
    await channel.deleteQueue(deadLetterQueue(SERVICE));
    await connection.close();
    await SCHEMA.drop();
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

  it('delivers events recorded together, in order', async () => {
    const envelopes = await db.transaction((tx) =>
      publisher.recordAll(tx, [
        { type: HAPPENED, tenant: 'psc', data: { n: 1 } },
        { type: HAPPENED, tenant: 'psc', data: { n: 2 } },
      ]),
    );

    expect(envelopes.map((envelope) => envelope.data)).toEqual([{ n: 1 }, { n: 2 }]);
    await waitFor(() =>
      envelopes.every((envelope) => received.some((event) => event.id === envelope.id)),
    );
    const order = received
      .filter((event) => envelopes.some((envelope) => envelope.id === event.id))
      .map((event) => event.data);
    expect(order).toEqual([{ n: 1 }, { n: 2 }]);
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

  // Last: it closes the app.
  it('closes while the relay is publishing a batch', async () => {
    const batch = await db.transaction(async (tx) => {
      const ids = new Set<string>();
      for (let i = 0; i < 300; i++) {
        ids.add((await publisher.record(tx, { type: HAPPENED, data: { i } })).id);
      }
      return ids;
    });
    // The first event arrives while the relay's transaction still holds the rest of its batch.
    await waitFor(() => received.some((event) => batch.has(event.id)), 10_000, 1);

    // A publish cut off by the broker client closing never settles; its open transaction kept
    // the pool, and so the close, from ending.
    closed = true;
    let stuck: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      app.close().then(() => 'closed'),
      new Promise((resolve) => (stuck = setTimeout(resolve, 10_000, 'stuck'))),
    ]);
    clearTimeout(stuck);
    expect(outcome).toBe('closed');
  });
});

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  intervalMs = 50,
) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
