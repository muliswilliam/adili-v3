import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClientProxy, ClientsModule, Transport } from '@nestjs/microservices';
import { ReadinessCheck } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import amqp from 'amqplib';
import { eq, isNull, sql } from 'drizzle-orm';
import { lastValueFrom } from 'rxjs';

import { AuditedReadInterceptor } from './audited-read.interceptor.js';
import { EventPublisher, EVENTS_OPTIONS, type EventsModuleOptions } from './event-publisher.js';
import { outbox } from './schema.js';
import { DEAD_LETTER_EXCHANGE, deadLetterQueue, EVENTS_EXCHANGE, eventsQueue } from './topology.js';

const EVENTS_CLIENT = Symbol('EVENTS_CLIENT');
const RELAY_BATCH_SIZE = 100;
const RELAY_IDLE_MS = 500;

/**
 * Relays committed outbox rows to the events exchange in order. Rows are claimed with
 * `FOR UPDATE SKIP LOCKED`, so several replicas can relay without double-publishing a batch.
 * Delivery is at-least-once; consumers deduplicate with `consumeOnce`.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    @InjectDatabase() private readonly db: Database,
    @Inject(EVENTS_CLIENT) private readonly client: ClientProxy,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.relayBatch()
        .then((full) => {
          this.schedule(full ? 0 : RELAY_IDLE_MS);
        })
        .catch((error: unknown) => {
          this.logger.warn({ err: error }, 'Outbox relay failed; retrying');
          this.schedule(RELAY_IDLE_MS * 4);
        });
    }, delayMs);
  }

  /** Returns true when the batch was full and more rows may be waiting. */
  private async relayBatch(): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: outbox.id, eventType: outbox.eventType, envelope: outbox.envelope })
        .from(outbox)
        .where(isNull(outbox.publishedAt))
        .orderBy(outbox.id)
        .limit(RELAY_BATCH_SIZE)
        .for('update', { skipLocked: true });

      for (const row of rows) {
        try {
          await lastValueFrom(this.client.emit(row.eventType, row.envelope), {
            defaultValue: undefined,
          });
        } catch (error) {
          // Stop at the first failure to keep per-service ordering.
          await tx
            .update(outbox)
            .set({ attempts: sql`${outbox.attempts} + 1`, lastError: String(error) })
            .where(eq(outbox.id, row.id));
          return false;
        }
        await tx.update(outbox).set({ publishedAt: new Date() }).where(eq(outbox.id, row.id));
      }
      return rows.length === RELAY_BATCH_SIZE;
    });
  }
}

/**
 * Declares the shared exchanges and this service's dead-letter queue, and keeps a connection
 * for readiness checks. The events queue itself is declared by the Nest RMQ server.
 */
@Injectable()
export class RabbitMqReadinessCheck
  extends ReadinessCheck
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  readonly name = 'rabbitmq';
  private readonly logger = new Logger(RabbitMqReadinessCheck.name);
  private connection: amqp.ChannelModel | undefined;

  constructor(@Inject(EVENTS_OPTIONS) private readonly options: EventsModuleOptions) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.declareTopology();
    } catch (error) {
      // Stay up and report not-ready; the next readiness check reconnects.
      this.logger.warn({ err: error }, 'RabbitMQ unavailable at startup');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connection?.close().catch(() => undefined);
  }

  async check(): Promise<void> {
    if (!this.connection) {
      await this.declareTopology();
    }
    const channel = await this.connection?.createChannel();
    await channel?.close();
  }

  private async declareTopology(): Promise<void> {
    const connection = await amqp.connect(this.options.rabbitmqUrl);
    connection.on('close', () => {
      this.connection = undefined;
    });
    connection.on('error', (error: unknown) => {
      this.logger.warn({ err: error }, 'RabbitMQ connection error');
    });
    const channel = await connection.createChannel();
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
    const dlq = deadLetterQueue(this.options.service);
    await channel.assertQueue(dlq, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    await channel.bindQueue(dlq, DEAD_LETTER_EXCHANGE, eventsQueue(this.options.service));
    await channel.close();
    this.connection = connection;
  }
}

@Module({})
export class EventsModule {
  static forRoot(options: EventsModuleOptions): DynamicModule {
    return {
      module: EventsModule,
      global: true,
      imports: [
        ClientsModule.register([
          {
            name: EVENTS_CLIENT,
            transport: Transport.RMQ,
            options: {
              urls: [options.rabbitmqUrl],
              exchange: EVENTS_EXCHANGE,
              exchangeType: 'topic',
              wildcards: true,
              persistent: true,
            },
          },
        ]),
      ],
      providers: [
        { provide: EVENTS_OPTIONS, useValue: options },
        EventPublisher,
        OutboxRelay,
        RabbitMqReadinessCheck,
        // Audited reads (ADR-008) go through the outbox like every other event.
        { provide: APP_INTERCEPTOR, useClass: AuditedReadInterceptor },
      ],
      exports: [EventPublisher, RabbitMqReadinessCheck],
    };
  }
}
