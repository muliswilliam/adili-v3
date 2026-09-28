import { tenantEvent } from '../../tenant-event.js';
import type { EventActor } from '../actor.js';

/**
 * Events about a Commission's HR-system credential (spec #27). Ids only, never the secret. The
 * `tenant` extension is the Commission's slug; the subject is the API client; `actor` is the
 * reporting officer who changed it.
 */

export const ROSTER_API_CREDENTIAL_CHANGED = 'roster.api-credential.changed.v1';

export type ApiCredentialAction = 'created' | 'rotated' | 'revoked';

export interface ApiCredentialChangedData extends Record<string, unknown> {
  action: ApiCredentialAction;
  /** OAuth client id of the credential. */
  clientId: string;
  actor: EventActor;
}

export const apiCredentialChanged = tenantEvent<ApiCredentialChangedData>(
  ROSTER_API_CREDENTIAL_CHANGED,
  (data) => data.clientId,
);
