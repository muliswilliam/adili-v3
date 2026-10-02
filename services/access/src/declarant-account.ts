import type { Logger } from '@nestjs/common';
import { withTenant } from '@adili/data-access';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { AccessDatabase, AccessTransaction } from './db/database.js';
import { DirectoryClient } from './directory/directory-client.js';
import { leaRequests } from './lea/schema.js';
import { accessRequests, representations } from './requests/schema.js';
import { messageKey } from './requests/workflow-support.js';
import { systemContext } from './system-context.js';

/**
 * The declarant of a request resolved to a roster record whose officer has no account yet (spec
 * 10 decision 2). The request keeps the roster record and no person until the officer onboards;
 * then it is linked, by the roster record, to the person they onboarded as: on the directory's
 * `declarant.onboarded.v1` (declarant-onboarded.consumer.ts), or when a workflow reads the record
 * from the directory. Meanwhile the directory invites them to onboard, once per request.
 */

/** The requests a link reached: their ids, to signal their workflows. */
export interface LinkedRequests {
  formK: string[];
  lea: string[];
}

/**
 * Links the requests of the Commission resolved to roster record `recordId` and still without a
 * declarant to `personId`, and the representations entered on their behalf meanwhile, so the
 * declarant sees their notices, representations and who-accessed history. Runs in the caller's
 * transaction, in the Commission's context; a request linked already is left as it is.
 */
export async function linkDeclarant(
  tx: AccessTransaction,
  recordId: string,
  personId: string,
): Promise<LinkedRequests> {
  const formK = await tx
    .update(accessRequests)
    .set({ resolvedPersonId: personId })
    .where(
      and(
        eq(accessRequests.resolvedRosterRecordId, recordId),
        isNull(accessRequests.resolvedPersonId),
      ),
    )
    .returning({ id: accessRequests.id });
  if (formK.length > 0) {
    await tx
      .update(representations)
      .set({ personId })
      .where(
        and(
          inArray(
            representations.requestId,
            formK.map((row) => row.id),
          ),
          isNull(representations.personId),
        ),
      );
  }
  const lea = await tx
    .update(leaRequests)
    .set({ resolvedPersonId: personId })
    .where(
      and(eq(leaRequests.resolvedRosterRecordId, recordId), isNull(leaRequests.resolvedPersonId)),
    )
    .returning({ id: leaRequests.id });
  return { formK: formK.map((row) => row.id), lea: lea.map((row) => row.id) };
}

/** A request resolved to a roster record, as the declarant's account steps read it. */
interface ResolvedRequest {
  id: string;
  tenant: string;
  resolvedRosterRecordId: string | null;
  resolvedPersonId: string | null;
  declarantInvitedAt: Date | null;
}

/**
 * Where the declarant's account stands for a request whose officer had none: `linked` (the
 * directory says they have onboarded since, and the request is linked now), or `none` (still no
 * account: invited to onboard, once, unless the roster record is gone).
 */
export type DeclarantAccount = 'linked' | 'none';

/**
 * Reads the request's roster record from the directory: onboarded since, the request (and every
 * other of the Commission resolved to the record) is linked to the person; otherwise its officer
 * is invited to onboard, once per request (`declarant_invited_at`). An unreachable directory
 * propagates (the activity is retried).
 */
export async function declarantAccount(
  db: AccessDatabase,
  directory: DirectoryClient,
  logger: Logger,
  table: 'form-k' | 'lea',
  row: ResolvedRequest,
): Promise<DeclarantAccount> {
  const recordId = row.resolvedRosterRecordId;
  if (recordId === null) throw new Error(`Request ${row.id} is not resolved to a roster record`);
  if (row.resolvedPersonId !== null) return 'linked';

  if (await linkFromDirectory(db, directory, row.tenant, recordId)) return 'linked';
  if (row.declarantInvitedAt !== null) return 'none';

  const invited = await directory.inviteToOnboard(
    row.tenant,
    recordId,
    messageKey(row.id, 'onboarding-invitation'),
  );
  if (invited === 'onboarded') {
    // Onboarded between the two reads.
    return (await linkFromDirectory(db, directory, row.tenant, recordId)) ? 'linked' : 'none';
  }
  if (invited === null) {
    logger.warn({ recordId: row.id }, 'The roster record of the request is gone: not invited');
    return 'none';
  }
  if (invited.channels.length === 0) {
    logger.warn({ recordId: row.id }, 'The roster holds no contact the invitation could reach');
  }
  await withTenant(db, systemContext(row.tenant), (tx) =>
    table === 'form-k'
      ? tx
          .update(accessRequests)
          .set({ declarantInvitedAt: invited.sentAt })
          .where(and(eq(accessRequests.id, row.id), isNull(accessRequests.declarantInvitedAt)))
      : tx
          .update(leaRequests)
          .set({ declarantInvitedAt: invited.sentAt })
          .where(and(eq(leaRequests.id, row.id), isNull(leaRequests.declarantInvitedAt))),
  );
  return 'none';
}

/** Links the record's requests when the directory says its officer has onboarded. */
async function linkFromDirectory(
  db: AccessDatabase,
  directory: DirectoryClient,
  tenant: string,
  recordId: string,
): Promise<boolean> {
  const record = await directory.rosterRecord(tenant, recordId);
  const personId = record?.personId ?? null;
  if (personId === null) return false;
  await withTenant(db, systemContext(tenant), (tx) => linkDeclarant(tx, recordId, personId));
  return true;
}
