import { createDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';

import { config, SERVICE_NAME } from '../config.js';
import { seedDemoGatePolicies } from '../policy/demo-seed.js';
import { GatePolicies } from '../policy/gate-policies.js';
import { schema } from './schema.js';

const db = createDatabase({ url: config.DATABASE_URL, schema, applicationName: 'ai-gateway-seed' });
try {
  const events = new EventPublisher({ service: SERVICE_NAME, rabbitmqUrl: config.RABBITMQ_URL });
  const changed = await seedDemoGatePolicies(new GatePolicies(db, events));
  console.log(
    changed.length > 0
      ? `ai-gateway: external providers allowed on synthetic data for ${changed.join(', ')}`
      : 'ai-gateway: demo gate policies already recorded',
  );
} finally {
  await db.$client.end();
}
