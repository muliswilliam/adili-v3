import { config } from '../../config.js';
import {
  DECLARANT_REQUIRED_ACTIONS,
  type ExecuteActionsEmailOptions,
} from '../../identity/identity-provisioning.js';

/** How long a set-password link stays valid (spec 03). */
export const SET_PASSWORD_LINK_LIFESPAN_SECONDS = 24 * 60 * 60;

/**
 * Keycloak's execute-actions email that has a new declarant set their password: valid 24 hours,
 * then back to the portal's sign-in (a redirect URI of the realm's `portal` client).
 */
export function setPasswordEmail(): ExecuteActionsEmailOptions {
  return {
    actions: DECLARANT_REQUIRED_ACTIONS,
    lifespanSeconds: SET_PASSWORD_LINK_LIFESPAN_SECONDS,
    redirectUri: `${config.PORTAL_URL.replace(/\/+$/, '')}/auth/login`,
    clientId: 'portal',
  };
}
