import type { Database } from '@adili/data-access';

import type { DeclarationsSchema } from './schema.js';

/** A transaction on the declarations database, as `withPerson`, `withTenant` and Drizzle pass it. */
export type Transaction = Parameters<Parameters<Database<DeclarationsSchema>['transaction']>[0]>[0];
