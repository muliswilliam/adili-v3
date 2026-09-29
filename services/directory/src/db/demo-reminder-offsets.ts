/**
 * Local reminder demo (#92): `pnpm --filter @adili/directory demo:reminder-offsets [slug]
 * [offsets] [obligations-start-date]` puts a policy version with short reminder offsets in force
 * for a demo Commission (default `psc`, offsets `29,7,1`, the current start date), so an officer
 * appointed yesterday is reminded today. The running directory's outbox relay announces it to the
 * declarations service. Local data only.
 */
import { createDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';

import { DEMO_COMMISSIONS, useDemoReminderOffsets } from '../commissions/demo-seed.js';
import { config } from '../config.js';
import { schema } from './schema.js';

const [tenant = 'psc', offsets = '29,7,1', obligationsStartDate] = process.argv.slice(2);
if (!DEMO_COMMISSIONS.some((demo) => demo.slug === tenant)) {
  throw new Error(`Not a demo Commission: ${tenant}`);
}
const reminderOffsetsDays = offsets.split(',').map(Number);
if (!reminderOffsetsDays.every((days) => Number.isInteger(days) && days >= 0 && days <= 366)) {
  throw new Error(`Offsets must be whole days from 0 to 366, comma-separated: ${offsets}`);
}
if (obligationsStartDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(obligationsStartDate)) {
  throw new Error(`The obligations start date must be YYYY-MM-DD: ${obligationsStartDate}`);
}

const db = createDatabase({ url: config.DATABASE_URL, schema, applicationName: 'directory-demo' });
try {
  const events = new EventPublisher({ service: 'directory', rabbitmqUrl: config.RABBITMQ_URL });
  await useDemoReminderOffsets(db, events, { tenant, reminderOffsetsDays, obligationsStartDate });
  console.log(`directory: ${tenant} reminds ${reminderOffsetsDays.join(', ')} days before due`);
} finally {
  await db.$client.end();
}
