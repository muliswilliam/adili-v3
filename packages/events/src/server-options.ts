import { type RmqOptions, Transport } from '@nestjs/microservices';

import {
  EVENTS_EXCHANGE,
  eventsQueue,
  eventsQueueArguments,
  RABBITMQ_CONNECT_TIMEOUT_MS,
} from './topology.js';

export interface EventsServerOptions {
  service: string;
  rabbitmqUrl: string;
  prefetchCount?: number;
}

/**
 * RabbitMQ transport for a service's event consumers. The service gets one durable queue
 * bound to the topic exchange once per `@OnEvent(type)` handler (`wildcards: true`).
 */
export function eventsServerOptions(options: EventsServerOptions): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls: [options.rabbitmqUrl],
      queue: eventsQueue(options.service),
      queueOptions: { durable: true, arguments: eventsQueueArguments(options.service) },
      exchange: EVENTS_EXCHANGE,
      exchangeType: 'topic',
      wildcards: true,
      noAck: false,
      prefetchCount: options.prefetchCount ?? 20,
      socketOptions: { connectionOptions: { timeout: RABBITMQ_CONNECT_TIMEOUT_MS } },
    },
  };
}
