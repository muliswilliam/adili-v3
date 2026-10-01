import { Inject, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal } from '@adili/api-kit';
import { DATABASE, FieldCipher, withTenant } from '@adili/data-access';
import { eq } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';

import { ownCommissionTenant, requireAccessOfficer } from '../access.js';
import { Clock } from '../clock.js';
import type { AccessDatabase, AccessTransaction } from '../db/database.js';
import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import { directoryUnavailable, problem } from '../problems.js';
import { AccessRegister } from '../register/access-register.js';
import { openFormK } from './form-k.js';
import { type OfficerRequestView, toOfficerRequestView } from './officer-view.js';
import type { AccessRequestRow } from './representation.js';
import { accessRequests, type ApplicantVerification, representations } from './schema.js';
import { officerTimeline, registerEntriesOf } from './timeline.js';

/** Body of `verifyApplicantIdentity`. */
export const verifyApplicantBody = z.strictObject({
  /** The particulars the applicant entered check out (true), or they do not (false). */
  verified: z.boolean(),
  /** What the access officer checked, in their words; never a document number. */
  note: z.string().trim().min(1).max(1000),
});
export type VerifyApplicantBody = z.infer<typeof verifyApplicantBody>;

/** Namespace of the directory verification's idempotency keys (UUID v5 of the request id). */
const VERIFICATION_KEY_NAMESPACE = '6f1d3c2a-8b4e-4a57-9e0c-2d7b5f3a1c84';

/**
 * The access officer's manual verification of a passport applicant (spec 10, S2): a request
 * held `pending-applicant-verification` goes ahead once the officer has checked the particulars
 * the applicant entered.
 */
@Injectable()
export class ApplicantVerificationService {
  private readonly logger = new Logger(ApplicantVerificationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly directory: DirectoryClient,
    private readonly cipher: FieldCipher,
    private readonly register: AccessRegister,
    private readonly clock: Clock,
  ) {}

  /**
   * Records the access officer's check on request `requestId` of their Commission (404 for any
   * other; 403 for its supervisor, who reads). Only a request held for verification can be
   * verified: 409 `not-pending-verification` otherwise.
   *
   * Verified: the directory first records the applicant's identity as `verified` (on the person
   * and the account, so their next requests are not held), then the request becomes `submitted`
   * with the officer's check on it, and the `verified` register entry and its event are recorded.
   * The directory unreachable is 503 and nothing changes here; its record is idempotent (the key
   * is the request's), so trying again is safe.
   *
   * Not verified: the officer's check is recorded on the request, which stays held (the officer
   * may verify it later, or the applicant withdraw it); nothing is published.
   */
  async verify(
    principal: Principal,
    requestId: string,
    body: VerifyApplicantBody,
  ): Promise<OfficerRequestView> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'verify an applicant');
    const context = { tenant, subject: principal.subject };

    const pending = notFoundIfInvisible(
      await withTenant(this.db, context, (tx) => requestRow(tx, requestId)),
    );
    requirePending(pending);
    if (body.verified) {
      await this.recordInDirectory(tenant, pending.applicantPersonId, requestId, principal);
    }

    const now = this.clock.now();
    const verification: ApplicantVerification = {
      verified: body.verified,
      note: body.note,
      by: principal.subject,
      byName: principal.name ?? principal.subject,
      at: now.toISOString(),
    };
    const { row, entries, representationsRow } = await withTenant(this.db, context, async (tx) => {
      const current = notFoundIfInvisible(await requestRow(tx, requestId, { lock: true }));
      requirePending(current);
      const [updated] = await tx
        .update(accessRequests)
        .set(
          body.verified
            ? {
                applicantVerification: verification,
                applicantIdentityStatus: 'verified',
                status: 'submitted',
              }
            : { applicantVerification: verification },
        )
        .where(eq(accessRequests.id, current.id))
        .returning();
      if (!updated) throw new Error('The access request was not updated');
      if (body.verified) {
        await this.register.record(tx, {
          tenant,
          subjectKind: 'access-request',
          subjectId: updated.id,
          reference: updated.reference,
          personId: updated.resolvedPersonId,
          kind: 'verified',
          actor: { subject: principal.subject, name: principal.name },
          at: now,
        });
      }
      const [representationsRow] = await tx
        .select()
        .from(representations)
        .where(eq(representations.requestId, updated.id));
      return {
        row: updated,
        entries: (await registerEntriesOf(tx, [updated.id])).get(updated.id) ?? [],
        representationsRow: representationsRow ?? null,
      };
    });
    const formK = await openFormK(this.cipher, row);
    return toOfficerRequestView(row, formK, officerTimeline(entries), representationsRow);
  }

  private async recordInDirectory(
    tenant: string,
    personId: string,
    requestId: string,
    principal: Principal,
  ): Promise<void> {
    let applicant;
    try {
      applicant = await this.directory.verifyApplicantIdentity({
        personId,
        tenant,
        verifiedBy: principal.subject,
        idempotencyKey: uuidv5(requestId, VERIFICATION_KEY_NAMESPACE),
      });
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
    if (applicant === null) {
      // The request's applicant has no person in the directory any more: nothing to verify.
      this.logger.error(
        { requestId },
        'The applicant of a held request is unknown to the directory',
      );
      throw new Error(`The applicant of request ${requestId} is unknown to the directory`);
    }
  }
}

async function requestRow(
  tx: AccessTransaction,
  requestId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<AccessRequestRow | undefined> {
  const query = tx.select().from(accessRequests).where(eq(accessRequests.id, requestId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

function requirePending(row: AccessRequestRow): void {
  if (row.status !== 'pending-applicant-verification') {
    throw problem(
      'not-pending-verification',
      "The request is not waiting for the applicant's identity to be verified.",
    );
  }
}
