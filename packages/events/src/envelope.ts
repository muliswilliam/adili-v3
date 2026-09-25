import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/**
 * CloudEvents 1.0 envelope (JSON format) for every domain event (ADR-005).
 * Events carry IDs and non-sensitive facts only, never financial content (ADR-013 §3).
 */
export const eventEnvelopeSchema = z.object({
  specversion: z.literal('1.0'),
  id: z.uuid(),
  /** Producing service, e.g. `adili/declarations`. */
  source: z.string().min(1),
  /** Versioned event type, e.g. `declaration.submitted.v1`. Also the AMQP routing key. */
  type: z.string().regex(/^[a-z]+(\.[a-z-]+)+\.v\d+$/),
  time: z.iso.datetime({ offset: true }),
  /** Aggregate the event is about, e.g. a declaration ID. */
  subject: z.string().optional(),
  datacontenttype: z.literal('application/json'),
  /** Extension: tenant the event belongs to. */
  tenant: z.string().optional(),
  /** Extension: W3C trace context of the producing request. */
  traceparent: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
});

export type EventEnvelope<TData extends Record<string, unknown> = Record<string, unknown>> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  'data'
> & { data: TData };

export interface NewEvent<TData extends Record<string, unknown> = Record<string, unknown>> {
  type: string;
  data: TData;
  subject?: string;
  tenant?: string;
  traceparent?: string;
}

export function createEnvelope<TData extends Record<string, unknown>>(
  source: string,
  event: NewEvent<TData>,
): EventEnvelope<TData> {
  return {
    specversion: '1.0',
    id: uuidv7(),
    source,
    type: event.type,
    time: new Date().toISOString(),
    subject: event.subject,
    datacontenttype: 'application/json',
    tenant: event.tenant,
    traceparent: event.traceparent,
    data: event.data,
  };
}
