import { LAW_ENFORCEMENT_TENANT } from '@adili/roles';
import type { NewEvent } from '@adili/events';

/**
 * Events the directory publishes about law-enforcement officer accounts (spec 10). Ids and the
 * agency code only: no names, emails or phone numbers (ADR-013 §3). The subject is the officer's
 * person id; the `tenant` extension is `lea`, the tenant of every officer account.
 */

export const LEA_ACCOUNT_PROVISIONED = 'lea.account.provisioned.v1';
export const LEA_ACCOUNT_ACTIVATED = 'lea.account.activated.v1';
export const LEA_ACCOUNT_REVOKED = 'lea.account.revoked.v1';

export interface LeaAccountData extends Record<string, unknown> {
  /** The officer's directory person: the id services address them by. */
  personId: string;
  agencyCode: string;
  /** The officer's account: the `sub` of their tokens. */
  keycloakUserId: string;
}

function leaAccountEvent(type: string) {
  return (data: LeaAccountData): NewEvent<LeaAccountData> => ({
    type,
    subject: data.personId,
    tenant: LAW_ENFORCEMENT_TENANT,
    data,
  });
}

/**
 * An officer account was provisioned (or a revoked one provisioned again); its one activation
 * email follows the commit.
 */
export const leaAccountProvisioned = leaAccountEvent(LEA_ACCOUNT_PROVISIONED);

/** The officer signed in for the first time: their first authenticated request reached the directory. */
export const leaAccountActivated = leaAccountEvent(LEA_ACCOUNT_ACTIVATED);

/** The officer account was disabled: it signs in no more, and its requests stop. */
export const leaAccountRevoked = leaAccountEvent(LEA_ACCOUNT_REVOKED);
