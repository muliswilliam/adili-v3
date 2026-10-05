/** Topic exchange all domain events are published to; routing key = event type. */
export const EVENTS_EXCHANGE = 'adili.events';
/** Receives messages a consumer rejected twice; each service has its own dead-letter queue. */
export const DEAD_LETTER_EXCHANGE = 'adili.events.dlx';

export const eventsQueue = (service: string) => `${service}.events`;
export const deadLetterQueue = (service: string) => `${service}.events.dlq`;

/** Queue arguments must be identical everywhere the queue is declared. */
export function eventsQueueArguments(service: string): Record<string, unknown> {
  return {
    'x-queue-type': 'quorum',
    'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
    'x-dead-letter-routing-key': eventsQueue(service),
  };
}

/**
 * How long opening a RabbitMQ connection (TCP, then the AMQP handshake) may sit idle before it
 * fails. Without a bound, a peer that accepts and never answers holds the connect, and whatever
 * awaits it (bootstrap, a publish, shutdown), forever: a broker stuck starting, a half-open proxy,
 * or a socket connected to itself, which Linux does for a connect to an unused local port in its
 * ephemeral range (32768 to 60999, where the local broker's 55672 falls).
 */
export const RABBITMQ_CONNECT_TIMEOUT_MS = 10_000;
