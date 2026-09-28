import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { commissions } from '../../commissions/schema.js';

/**
 * The HR-system credential of each Commission (spec #27): metadata of its API client in the
 * identity provider, never the secret. One row per tenant, tenant-scoped under RLS (FORCE ROW
 * LEVEL SECURITY, policy in migration 0007). Creating a credential after a revocation replaces
 * the revoked row; the `roster.api-credential.changed.v1` events keep the history.
 */
export const rosterApiCredentials = pgTable(
  'roster_api_credentials',
  {
    tenant: text()
      .primaryKey()
      .references(() => commissions.slug),
    /** OAuth client id of the API client (`azp` of its tokens), e.g. `roster-psc-3f9a2c1d`. */
    keycloakClientId: text().notNull(),
    /** `sub` of the reporting officer who created it. */
    createdBy: text().notNull(),
    /** Their display name when they created it (token `name`), for "created by". */
    createdByName: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    /** Last request authenticated with one of its tokens, bumped at most once a minute. */
    lastUsedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('roster_api_credentials_keycloak_client_id_key').on(table.keycloakClientId),
  ],
);

export const apiCredentialSchema = { rosterApiCredentials };
