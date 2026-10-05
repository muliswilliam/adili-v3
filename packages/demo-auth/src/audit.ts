import amqp from 'amqplib';
import { v7 as uuidv7 } from 'uuid';

import type { DemoApp } from './accounts.ts';

/**
 * The audit event for a role switch (#616), as the audit service files it (`audit.demo-switch.v1`
 * in `@adili/events/contracts`, #593): kind `auth`, action `demo.account-switched`.
 */
export const AUDIT_DEMO_SWITCH = 'audit.demo-switch.v1';

/** Topic exchange every domain event goes to (`EVENTS_EXCHANGE` in `@adili/events`). */
const EVENTS_EXCHANGE = 'adili.events';

export interface DemoSwitchAccount extends Record<string, unknown> {
  username: string;
  subject: string | null;
  tenant: string | null;
  roles: string[];
}

export interface DemoSwitchData extends Record<string, unknown> {
  app: DemoApp;
  /** Who was signed in; null when nobody was. */
  from: DemoSwitchAccount | null;
  to: DemoSwitchAccount;
  outcome: 'success';
}

/** The CloudEvents envelope (ADR-005) of a switch. */
export function demoSwitchEvent(data: DemoSwitchData, now = new Date()) {
  return {
    specversion: '1.0' as const,
    id: uuidv7(),
    source: `adili/${data.app}`,
    type: AUDIT_DEMO_SWITCH,
    time: now.toISOString(),
    subject: data.to.username,
    datacontenttype: 'application/json' as const,
    tenant: 'platform',
    data,
  };
}

export type DemoSwitchEvent = ReturnType<typeof demoSwitchEvent>;

/**
 * Publishes `event` to the events exchange and waits for the broker's confirm, so a switch is
 * recorded before it happens. The body is how Nest's RabbitMQ client frames an emitted event,
 * which the services' consumers read.
 */
export async function publishDemoSwitch(rabbitmqUrl: string, event: DemoSwitchEvent) {
  const connection = await amqp.connect(rabbitmqUrl);
  try {
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    channel.publish(
      EVENTS_EXCHANGE,
      event.type,
      Buffer.from(JSON.stringify({ pattern: event.type, data: event })),
      { persistent: true, contentType: 'application/json', messageId: event.id },
    );
    await channel.waitForConfirms();
    await channel.close();
  } finally {
    await connection.close();
  }
}
