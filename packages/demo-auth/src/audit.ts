import {
  AUDIT_DEMO_SWITCH,
  type DemoSwitchAccount,
  type DemoSwitchData,
} from '@adili/events/contracts';
import amqp from 'amqplib';
import { v7 as uuidv7 } from 'uuid';

/** Topic exchange every domain event goes to (`EVENTS_EXCHANGE` in `@adili/events`). */
const EVENTS_EXCHANGE = 'adili.events';

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

export { AUDIT_DEMO_SWITCH, type DemoSwitchAccount, type DemoSwitchData };

/**
 * Publishes `event` to the events exchange and waits for the broker's confirm, so a switch is
 * recorded before it happens (the audit service's queue holds it). The body is how Nest's
 * RabbitMQ client frames an emitted event, which the services' consumers read.
 */
export async function publishDemoSwitch(rabbitmqUrl: string, event: DemoSwitchEvent) {
  const connection = await amqp.connect(rabbitmqUrl);
  try {
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    // Mandatory: with no queue bound for it (the audit service never started), the broker returns
    // the message before it confirms, and the switch is refused instead of going unrecorded.
    const delivery = { returned: false };
    channel.on('return', () => {
      delivery.returned = true;
    });
    channel.publish(
      EVENTS_EXCHANGE,
      event.type,
      Buffer.from(JSON.stringify({ pattern: event.type, data: event })),
      { persistent: true, mandatory: true, contentType: 'application/json', messageId: event.id },
    );
    await channel.waitForConfirms();
    await channel.close();
    if (delivery.returned)
      throw new Error(`no queue receives ${event.type}; is the audit service running?`);
  } finally {
    await connection.close();
  }
}
