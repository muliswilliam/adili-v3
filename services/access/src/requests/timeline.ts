import { and, asc, eq, inArray } from 'drizzle-orm';

import type { AccessTransaction } from '../db/database.js';
import type { AccessSubjectKind } from '@adili/events/contracts';

import type { RegisterRow } from '../register/access-register.js';
import { type RegisterEntry, toRegisterEntry } from '../register/representation.js';
import { accessRegister } from '../register/schema.js';

/**
 * A request's timeline: its register entries, oldest first. Read in the caller's context, so the
 * register's row-level security (an entry is visible to whoever sees its request) applies.
 * `subjectKind` says which requests the ids are: Form K (the default) or law enforcement.
 */
export async function registerEntriesOf(
  tx: AccessTransaction,
  requestIds: readonly string[],
  subjectKind: Extract<AccessSubjectKind, 'access-request' | 'lea-request'> = 'access-request',
): Promise<Map<string, RegisterRow[]>> {
  const byRequest = new Map<string, RegisterRow[]>(requestIds.map((id) => [id, []]));
  if (requestIds.length === 0) return byRequest;
  const rows = await tx
    .select()
    .from(accessRegister)
    .where(
      and(
        eq(accessRegister.subjectKind, subjectKind),
        inArray(accessRegister.subjectId, [...requestIds]),
      ),
    )
    .orderBy(asc(accessRegister.at), asc(accessRegister.id));
  for (const row of rows) byRequest.get(row.subjectId)?.push(row);
  return byRequest;
}

/** The whole timeline, as the Commission's access officer and supervisor see it. */
export function officerTimeline(rows: readonly RegisterRow[]): RegisterEntry[] {
  return rows.map(toRegisterEntry);
}

/**
 * The timeline as the applicant sees it: every step but the declarant's representations (which
 * the applicant may not read, Act s.36(3)), with only the applicant's own name as an actor. The
 * Commission's staff and the declarant act as "the Commission" to the public.
 */
export function applicantTimeline(
  rows: readonly RegisterRow[],
  applicantSubject: string,
): RegisterEntry[] {
  return rows
    .filter((row) => row.kind !== 'representations')
    .map((row) => {
      const entry = toRegisterEntry(row);
      return row.actor === applicantSubject ? entry : { ...entry, actor: null };
    });
}
