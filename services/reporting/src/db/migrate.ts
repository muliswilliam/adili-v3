import { runMigrations } from '@adili/data-access';

import { config } from '../config.js';

await runMigrations(config.DATABASE_URL, new URL('../../migrations', import.meta.url).pathname);
console.log('reporting: migrations applied');
