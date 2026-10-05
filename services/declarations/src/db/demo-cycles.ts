/**
 * The demo seed's cycles (#617): `pnpm --filter @adili/declarations demo:cycles 2024,2026 400`
 * opens the demo cycles (`addDemoCycles`). Prints `changed` or `unchanged`. Refused when
 * NODE_ENV is production.
 */
import { createDatabase } from '@adili/data-access';

import { config } from '../config.js';
import { addDemoCycles } from '../obligations/demo-seed.js';
import { schema } from './schema.js';

if (config.NODE_ENV === 'production') {
  throw new Error('The demo cycles change the platform calendar: not in production');
}
const [yearsArg = '', leadArg = ''] = process.argv.slice(2);
const years = yearsArg.split(',').map(Number);
const lead = Number(leadArg);
if (!years.every((year) => Number.isInteger(year) && year >= 2020 && year <= 2040)) {
  throw new Error(`Cycle years must be comma-separated, 2020 to 2040: ${yearsArg}`);
}
if (!Number.isInteger(lead) || lead < 1 || lead > 3650) {
  throw new Error(`The opening lead must be 1 to 3650 days: ${leadArg}`);
}

const db = createDatabase({
  url: config.DATABASE_URL,
  schema,
  applicationName: 'declarations-demo',
});
try {
  console.log((await addDemoCycles(db, years, lead)).length > 0 ? 'changed' : 'unchanged');
} finally {
  await db.$client.end();
}
