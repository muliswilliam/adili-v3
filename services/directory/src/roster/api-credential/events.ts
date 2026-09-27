import type { NewEvent } from '@adili/events';

/**
 * Events about a Commission's HR-system credential (spec #27). Ids only, never the secret. The
 * `tenant` extension is the Commission's slug; the subject is the API client.
 */

export const ROSTER_API_CREDENTIAL_CHANGED = 'roster.api-credential.changed.v1';

export type ApiCredentialAction = 'created' | 'rotated' | 'revoked';

export interface ApiCredentialChangedData extends Record<string, unknown> {
  action: ApiCredentialAction;
  /** OAuth client id of the credential. */
  clientId: string;
}

export function apiCredentialChanged(
  slug: string,
  data: ApiCredentialChangedData,
): NewEvent<ApiCredentialChangedData> {
  return { type: ROSTER_API_CREDENTIAL_CHANGED, subject: data.clientId, tenant: slug, data };
}
