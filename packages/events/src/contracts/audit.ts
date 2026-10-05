/**
 * Event contracts for the audit trail alone (ADR-008): facts no service reads but the audit
 * service, which files them under the envelope's tenant. Reads (`audit.read.v1`) and verify
 * lookups (`audit.verification.v1`) live next to their producers; this file holds the rest.
 */

/** The apps a demo account switch can happen in. */
export const DEMO_SWITCH_APPS = ['portal', 'console'] as const;
export type DemoSwitchApp = (typeof DEMO_SWITCH_APPS)[number];

/**
 * A presenter switched the signed-in account with the demo role switcher (#616, `DEMO_MODE`
 * only). Published by the app's server straight to the events exchange, since the apps hold no
 * database and so no outbox. Tenant: `platform` (ADR-008 chains platform events apart from any
 * Commission's); subject: the account switched to.
 */
export const AUDIT_DEMO_SWITCH = 'audit.demo-switch.v1';

export interface DemoSwitchAccount {
  /** Keycloak username, e.g. `reviewer`. */
  username: string;
  /** Token `sub`; null when the app did not know it (the account switched to, before sign-in). */
  subject: string | null;
  /** The account's `tenant` claim; null when it has none or is not known yet. */
  tenant: string | null;
  roles: readonly string[];
}

export interface DemoSwitchData extends Record<string, unknown> {
  app: DemoSwitchApp;
  /** The account signed in before the switch; null when nobody was. */
  from: DemoSwitchAccount | null;
  /** The demo account switched to. */
  to: DemoSwitchAccount;
  outcome: 'success';
}
