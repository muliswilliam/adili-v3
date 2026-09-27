import { createDatabase } from '@adili/data-access';

import { seedDemoCommissions } from '../commissions/demo-seed.js';
import { config } from '../config.js';
import { schema } from './schema.js';

const db = createDatabase({ url: config.DATABASE_URL, schema, applicationName: 'directory-seed' });
try {
  await seedDemoCommissions(db);
  console.log('directory: demo Commissions seeded');
} finally {
  await db.$client.end();
}
