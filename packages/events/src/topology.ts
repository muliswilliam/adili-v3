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
