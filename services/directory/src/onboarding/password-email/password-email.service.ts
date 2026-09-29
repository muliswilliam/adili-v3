import { Injectable, Logger } from '@nestjs/common';
import { errorType, ProblemException } from '@adili/api-kit';
import { eq } from 'drizzle-orm';

import {
  IdentityProvisioning,
  IdentityUnavailable,
  IdentityUserNotFound,
} from '../../identity/identity-provisioning.js';
import { persons } from '../../persons/schema.js';
import { setPasswordEmail } from '../confirm/set-password-email.js';
import { OnboardingSessions, refuseDuringCooldown, wrongStep } from '../sessions.repository.js';

/**
 * Resending the set-password email (spec 03, "check your email"): only for a session confirmed
 * with a new account (409 otherwise), at most one a minute (429 `resend-cooldown` with
 * `retryAfterSeconds`), until 24 hours after confirm (the session's expiry, then 410). Keycloak's execute-actions email again, with a fresh 24-hour link; the
 * identity provider failing is 502 `identity-unavailable` and starts no cooldown.
 */
@Injectable()
export class PasswordEmailService {
  private readonly logger = new Logger(PasswordEmailService.name);

  constructor(
    private readonly sessions: OnboardingSessions,
    private readonly identity: IdentityProvisioning,
  ) {}

  async resend(sessionId: string, secret: string | undefined): Promise<void> {
    try {
      await this.sessions.withLiveSession(sessionId, secret, async ({ tx, session, now }) => {
        if (
          session.state !== 'confirmed' ||
          session.outcome !== 'account-created' ||
          session.personId === null
        ) {
          throw wrongStep();
        }
        refuseDuringCooldown(session.passwordEmailSentAt, now);
        const [person] = await tx
          .select({ keycloakUserId: persons.keycloakUserId })
          .from(persons)
          .where(eq(persons.id, session.personId));
        if (!person) throw new Error(`Person of session ${session.id} is gone`);
        await this.sessions.amend(tx, session, { passwordEmailSentAt: now, updatedAt: now });
        await this.identity.sendExecuteActionsEmail(person.keycloakUserId, setPasswordEmail());
      });
    } catch (error) {
      if (error instanceof IdentityUnavailable || error instanceof IdentityUserNotFound) {
        this.logger.warn({ sessionId, err: errorType(error) }, 'Set-password email not sent');
        throw ProblemException.fromCode('identity-unavailable');
      }
      throw error;
    }
  }
}
