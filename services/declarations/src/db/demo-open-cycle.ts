/**
 * Local obligations demo: `pnpm --filter @adili/declarations demo:open-cycle` opens the 2027
 * cycle from today (`openDemoCycle`), so declarants see their biennial 2027 obligation before 4
 * July 2027. It changes the platform's cycle calendar, so it is a separate, explicit step and not
 * part of `pnpm db:seed`. Local data only.
 */
import { createDatabase } from '@adili/data-access';

import { config } from '../config.js';
import { openDemoCycle } from '../obligations/demo-seed.js';
import { schema } from './schema.js';

const db = createDatabase({
  url: config.DATABASE_URL,
  schema,
  applicationName: 'declarations-demo',
});
try {
  await openDemoCycle(db, new Date());
  console.log('declarations: 2027 cycle open for the demo');
} finally {
  await db.$client.end();
}
