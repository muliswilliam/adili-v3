/**
 * The demo seed's policy step (#617): `pnpm --filter @adili/directory demo:policy '<json>'` puts
 * the demo policy in force for one Commission (`useDemoPolicy`): `{"tenant":"psc",
 * "reminderOffsetsDays":[30,14,7,1],"obligationsStartDate":"2024-06-30",
 * "biennial":{"statementDate":"06-30","dueDate":"12-31"}}`. No API changes the offsets or the
 * biennial dates (the product changes the obligations-start date alone, spec 04), so the seed
 * writes this version directly; the running directory's outbox relay announces it. Prints
 * `changed` or `unchanged`. Refused when NODE_ENV is production.
 */
import { createDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { z } from 'zod';

import { useDemoPolicy } from '../commissions/demo-seed.js';
import { config } from '../config.js';
import { schema } from './schema.js';

if (config.NODE_ENV === 'production') {
  throw new Error('The demo policy changes what the product never does: not in production');
}
const monthDay = z.string().regex(/^\d{2}-\d{2}$/);
const policy = z
  .object({
    tenant: z.string().min(1),
    reminderOffsetsDays: z.array(z.number().int().min(0).max(366)).min(1).optional(),
    obligationsStartDate: z.iso.date().optional(),
    biennial: z.object({ statementDate: monthDay, dueDate: monthDay }).optional(),
  })
  .strict()
  .parse(JSON.parse(process.argv[2] ?? '{}'));

const db = createDatabase({ url: config.DATABASE_URL, schema, applicationName: 'directory-demo' });
try {
  const events = new EventPublisher({ service: 'directory', rabbitmqUrl: config.RABBITMQ_URL });
  console.log((await useDemoPolicy(db, events, policy)) ? 'changed' : 'unchanged');
} finally {
  await db.$client.end();
}
