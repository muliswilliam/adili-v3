import type { Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';

import {
  type IdentityProvisioning,
  IdentityUnavailable,
  IdentityUserNotFound,
  type Restore,
} from '../../identity/identity-provisioning.js';
import { setPasswordEmail } from './set-password-email.js';

/**
 * What the steps that create an account share: declarants' confirm (spec 03) and applicants'
 * complete (spec 10).
 */

/** Undoes what the identity provider did for a step that did not commit, latest first. */
export async function undoIdentityChanges(
  undo: Restore[],
  logger: Logger,
  sessionId: string,
): Promise<void> {
  for (const restore of undo.reverse()) {
    try {
      await restore();
    } catch (error) {
      logger.error(
        { sessionId, err: errorType(error) },
        'Could not undo an identity change of a step that failed',
      );
    }
  }
}

/**
 * The set-password email of a committed new account; whether it went. Not sent, the account
 * stands (an email cannot be taken back, so it is not part of the transaction, ADR-014), and the
 * session says so, so the person can send it again.
 */
export async function sendSetPasswordEmail(
  identity: IdentityProvisioning,
  logger: Logger,
  sessionId: string,
  keycloakUserId: string,
): Promise<boolean> {
  try {
    await identity.sendExecuteActionsEmail(keycloakUserId, setPasswordEmail());
    return true;
  } catch (error) {
    if (!(error instanceof IdentityUnavailable || error instanceof IdentityUserNotFound)) {
      throw error;
    }
    logger.warn(
      { sessionId, err: errorType(error) },
      'Set-password email of a new account not sent; it can be resent',
    );
    return false;
  }
}
