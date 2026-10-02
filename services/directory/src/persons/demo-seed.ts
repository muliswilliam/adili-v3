import { PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, withTenant } from '@adili/data-access';

import type { DirectorySchema } from '../db/schema.js';
import { lawEnforcementOfficers } from '../law-enforcement/schema.js';
import { persons } from './schema.js';

/**
 * The persons behind the demo `applicant` and `law-enforcement` accounts in the Keycloak realm
 * import (infra/compose/keycloak/adili-realm.json), which name them in `person_id` and are
 * imported with these Keycloak ids. Keep the two files in step.
 */
export const DEMO_APPLICANT = {
  personId: '2c2097c9-c981-44f4-8343-3e5a124422cd',
  keycloakUserId: '7159c22a-33fd-4ba0-bcfd-23c91d6acd8e',
  fullName: 'Njoki Wambua',
  nationalId: '31415926',
  email: 'applicant@demo.adili.go.ke',
  phone: '+254700000012',
} as const;

/** The demo officer of the Directorate of Criminal Investigations (agency `DCI`, migration 0028). */
export const DEMO_LEA_OFFICER = {
  personId: 'a0221136-2e38-49ef-8a9b-7cdc1882e84e',
  keycloakUserId: '21aa54e7-20f5-4942-a0ab-990fad9cb8c2',
  fullName: 'Suleiman Ali',
  email: 'law-enforcement@demo.adili.go.ke',
  phone: '+254700000013',
  agencyCode: 'DCI',
} as const;

const SEEDED_BY = 'system:demo-seed';

/**
 * Creates the demo applicant, onboarded with a national ID IPRS matched (`verified`, so their
 * Form K goes straight to the Commission), and the demo law enforcement officer, `activated`.
 * Idempotent: existing rows are left as they are, so it is safe to run on every `pnpm db:seed`.
 */
export async function seedDemoPersons(db: Database<DirectorySchema>): Promise<void> {
  await withTenant(db, { tenant: PLATFORM_TENANT, subject: SEEDED_BY }, async (tx) => {
    const now = new Date();
    await tx
      .insert(persons)
      .values({
        id: DEMO_APPLICANT.personId,
        kind: 'applicant',
        nationalId: DEMO_APPLICANT.nationalId,
        fullName: DEMO_APPLICANT.fullName,
        identityStatus: 'verified',
        identityVerifiedAt: now,
        keycloakUserId: DEMO_APPLICANT.keycloakUserId,
        email: DEMO_APPLICANT.email,
        phone: DEMO_APPLICANT.phone,
      })
      .onConflictDoNothing();
    await tx
      .insert(persons)
      .values({
        id: DEMO_LEA_OFFICER.personId,
        kind: 'law-enforcement',
        fullName: DEMO_LEA_OFFICER.fullName,
        keycloakUserId: DEMO_LEA_OFFICER.keycloakUserId,
        email: DEMO_LEA_OFFICER.email,
        phone: DEMO_LEA_OFFICER.phone,
      })
      .onConflictDoNothing();
    await tx
      .insert(lawEnforcementOfficers)
      .values({
        personId: DEMO_LEA_OFFICER.personId,
        agencyCode: DEMO_LEA_OFFICER.agencyCode,
        state: 'activated',
        invitedAt: now,
        activatedAt: now,
        createdBy: SEEDED_BY,
      })
      .onConflictDoNothing();
  });
}
