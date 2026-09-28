import { createDatabase } from '@adili/data-access';

import { config } from '../config.js';
import { openDemoCycle } from '../obligations/demo-seed.js';
import { schema } from './schema.js';

const db = createDatabase({
  url: config.DATABASE_URL,
  schema,
  applicationName: 'declarations-seed',
});
try {
  await openDemoCycle(db, new Date());
  console.log('declarations: 2027 cycle open for the demo');
} finally {
  await db.$client.end();
}
