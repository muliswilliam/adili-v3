import type { Database } from '@adili/data-access';

import type { AccessSchema } from './schema.js';

/** The access database, as `DATABASE` provides it. */
export type AccessDatabase = Database<AccessSchema>;

/** An open transaction on the access database (`withTenant`, `withPerson`). */
export type AccessTransaction = Parameters<Parameters<AccessDatabase['transaction']>[0]>[0];
