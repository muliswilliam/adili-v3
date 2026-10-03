import { createDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';

import { config, SERVICE_NAME } from '../config.js';
import {
  DEMO_DOCUMENT_GATE_CHANGE,
  DEMO_TENANTS,
  seedDemoGatePolicies,
} from '../policy/demo-seed.js';
import { GatePolicies } from '../policy/gate-policies.js';
import { schema } from './schema.js';

const db = createDatabase({ url: config.DATABASE_URL, schema, applicationName: 'ai-gateway-seed' });
try {
  const events = new EventPublisher({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL });
  const gate = new GatePolicies(db, events);
  const changed = await seedDemoGatePolicies(gate);
  console.log(
    changed.length > 0
      ? `ai-gateway: external providers allowed on synthetic data for ${changed.join(', ')}`
      : 'ai-gateway: demo gate policies already recorded',
  );
  const reading = await seedDemoGatePolicies(gate, DEMO_TENANTS, DEMO_DOCUMENT_GATE_CHANGE);
  if (reading.length > 0) {
    console.log(
      `ai-gateway: synthetic documents may be read into the form for ${reading.join(', ')}`,
    );
  }
} finally {
  await db.$client.end();
}
