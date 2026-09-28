import { and, eq, isNull, or } from 'drizzle-orm';

import type { Transaction } from '../commissions/commissions.service.js';
import { type ContactSource, rosterRecords } from '../roster/schema.js';
import type { onboardingSessions } from './schema.js';
import type { OtpChannel } from './session-state.js';

type SessionRow = typeof onboardingSessions.$inferSelect;

/** A session's contact for one channel. */
export interface SessionContact {
  /** The email address, or the phone number in E.164. */
  value: string | null;
  source: ContactSource | null;
  verifiedAt: Date | null;
}

/** The session columns of each channel's contact. */
const SESSION_COLUMNS = {
  email: { value: 'email', source: 'emailSource', verifiedAt: 'emailVerifiedAt' },
  phone: { value: 'phone', source: 'phoneSource', verifiedAt: 'phoneVerifiedAt' },
} as const satisfies Record<OtpChannel, Record<keyof SessionContact, keyof SessionRow>>;

/** The session's contact for `channel`. */
export function sessionContact(session: SessionRow, channel: OtpChannel): SessionContact {
  const columns = SESSION_COLUMNS[channel];
  return {
    value: session[columns.value],
    source: session[columns.source],
    verifiedAt: session[columns.verifiedAt],
  };
}

/** Column changes that set the given parts of the session's contact for `channel`. */
export function sessionContactChanges(
  channel: OtpChannel,
  contact: Partial<SessionContact>,
): Partial<Pick<SessionRow, (typeof SESSION_COLUMNS)[OtpChannel][keyof SessionContact]>> {
  const columns = SESSION_COLUMNS[channel];
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
  channel: OtpChannel,
  now: Date,
): Promise<void> {
  const { value, source, verifiedAt } = sessionContact(session, channel);
  if (source !== 'declarant' || value === null || verifiedAt === null) return;
  const record =
    channel === 'email'
      ? { set: { email: value, emailSource: 'declarant' as const }, ...ROSTER_EMAIL }
      : { set: { phone: value, phoneSource: 'declarant' as const }, ...ROSTER_PHONE };
  await tx
    .update(rosterRecords)
    .set({ ...record.set, updatedAt: now })
    .where(
      and(
        eq(rosterRecords.id, session.rosterRecordId),
        or(isNull(record.value), eq(record.source, 'declarant')),
      ),
    );
}

const ROSTER_EMAIL = { value: rosterRecords.email, source: rosterRecords.emailSource };
const ROSTER_PHONE = { value: rosterRecords.phone, source: rosterRecords.phoneSource };
