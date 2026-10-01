import type { ContactChannel } from '@adili/contacts';
import { and, eq, isNull, or } from 'drizzle-orm';

import type { Transaction } from '../commissions/commissions.service.js';
import { rosterRecords } from '../roster/schema.js';
import { CHANNELS } from './channels.js';
import type { onboardingSessions, SessionContactSource } from './schema.js';

type SessionRow = typeof onboardingSessions.$inferSelect;
type SessionContactColumns = (typeof CHANNELS)[ContactChannel]['session'];

/** A session's contact for one channel. */
export interface SessionContact {
  /** The email address, or the phone number in E.164. */
  value: string | null;
  source: SessionContactSource | null;
  verifiedAt: Date | null;
}

/** The session's contact for `channel`. */
export function sessionContact(session: SessionRow, channel: ContactChannel): SessionContact {
  const columns = CHANNELS[channel].session;
  return {
    value: session[columns.value],
    source: session[columns.source],
    verifiedAt: session[columns.verifiedAt],
  };
}

/** Column changes that set the given parts of the session's contact for `channel`. */
export function sessionContactChanges(
  channel: ContactChannel,
  contact: Partial<SessionContact>,
): Partial<Pick<SessionRow, SessionContactColumns[keyof SessionContact]>> {
  const columns = CHANNELS[channel].session;
  return Object.fromEntries(
    (Object.keys(contact) as (keyof SessionContact)[]).map((part) => [
      columns[part],
      contact[part],
    ]),
  );
}

/**
 * Writes a contact the declarant supplied, once verified, to the session's roster record with
 * source `declarant`, so later notifications reach them (spec 03, S9). Only where the record
 * still has no contact of its own for the channel: roster contacts are not editable in this flow,
 * and one an import added meanwhile stays. Idempotent; a roster-sourced contact writes nothing.
 */
export async function writeBackDeclarantContact(
  tx: Transaction,
  session: SessionRow,
  channel: ContactChannel,
  now: Date,
): Promise<void> {
  const { value, source, verifiedAt } = sessionContact(session, channel);
  if (source !== 'declarant' || value === null || verifiedAt === null) return;
  if (session.rosterRecordId === null) return;
  const columns = CHANNELS[channel].roster;
  await tx
    .update(rosterRecords)
    .set({ [columns.value]: value, [columns.source]: 'declarant', updatedAt: now })
    .where(
      and(
        eq(rosterRecords.id, session.rosterRecordId),
        or(isNull(rosterRecords[columns.value]), eq(rosterRecords[columns.source], 'declarant')),
      ),
    );
}
