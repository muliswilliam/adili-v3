import { createDatabase } from '@adili/data-access';

import { seedDemoCommissions } from '../commissions/demo-seed.js';
import { config } from '../config.js';
import { seedDemoPersons } from '../persons/demo-seed.js';
import { schema } from './schema.js';

const db = createDatabase({ url: config.DATABASE_URL, schema, applicationName: 'directory-seed' });
try {
  await seedDemoCommissions(db);
  console.log('directory: demo Commissions seeded');
  await seedDemoPersons(db);
  console.log('directory: demo applicant and law enforcement officer seeded');
} finally {
  await db.$client.end();
}
