import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '@adili/api-kit';
import { DATABASE, withPerson } from '@adili/data-access';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { declarantPersonId } from '../access.js';
import type { AccessDatabase } from '../db/database.js';
import { leaRequests } from '../lea/schema.js';
import type { RegisterRow } from '../register/access-register.js';
import { accessRegister } from '../register/schema.js';
import { accessRequests } from '../requests/schema.js';
import { certifiedCopies } from '../self-access/schema.js';
import {
  type AccessHistoryEntry,
  FORM_K_VISIBLE_KINDS,
  type HistorySubject,
  LEA_VISIBLE_KINDS,
  toAccessHistoryEntry,
} from './representation.js';

/**
 * "Who accessed my declaration" (spec 10 S12, ADR-008, Administrative Mechanism 34): the access
 * register entries about the declarant, as they may see them. Read through the person axis, so
 * row-level security already hides requests about others, Form K requests not yet notified and
 * law enforcement requests not granted; the kinds and times each subject shows from are applied
 * here on top.
 */
@Injectable()
export class HistoryService {
  constructor(@Inject(DATABASE) private readonly db: AccessDatabase) {}

  /** The declarant's history, newest first. */
  async list(principal: Principal): Promise<AccessHistoryEntry[]> {
    const personId = declarantPersonId(principal);
    return withPerson(this.db, { personId, subject: principal.subject }, async (tx) => {
      const entries = await tx
        .select()
        .from(accessRegister)
        .where(eq(accessRegister.personId, personId))
        .orderBy(desc(accessRegister.at), desc(accessRegister.id));
      const ids = (kind: RegisterRow['subjectKind']) => [
        ...new Set(entries.filter((row) => row.subjectKind === kind).map((row) => row.subjectId)),
      ];
      const formK = ids('access-request');
      const lea = ids('lea-request');
      const copies = ids('self-access');

      const visible = new Map<string, HistorySubject & { from: Date | null }>();
      if (formK.length > 0) {
        const rows = await tx
          .select()
          .from(accessRequests)
          .where(
            and(
              inArray(accessRequests.id, formK),
              eq(accessRequests.resolvedPersonId, personId),
              isNotNull(accessRequests.notifiedAt),
            ),
          );
        for (const row of rows) {
          if (row.notifiedAt === null) continue;
          visible.set(row.id, {
            reference: row.reference,
            commission: { slug: row.tenant, name: row.commissionName },
            requester: row.applicantName,
            caseReference: null,
            from: row.notifiedAt,
          });
        }
      }
      if (lea.length > 0) {
        const rows = await tx
          .select()
          .from(leaRequests)
          .where(
            and(
              inArray(leaRequests.id, lea),
              eq(leaRequests.resolvedPersonId, personId),
              eq(leaRequests.status, 'granted'),
            ),
          );
        for (const row of rows) {
          // From the grant on: `LEA_VISIBLE_KINDS` starts at the decision.
          visible.set(row.id, {
            reference: row.reference,
            commission: { slug: row.tenant, name: row.commissionName },
            requester: row.agencyName,
            caseReference: row.caseReference,
            from: null,
          });
        }
      }
      if (copies.length > 0) {
        const rows = await tx
          .select()
          .from(certifiedCopies)
          .where(and(inArray(certifiedCopies.id, copies), eq(certifiedCopies.personId, personId)));
        for (const row of rows) {
          if (row.reference === null) continue;
          visible.set(row.id, {
            reference: row.reference,
            commission: { slug: row.tenant, name: row.commissionName },
            requester: null,
            caseReference: null,
            from: null,
          });
        }
      }

      return entries.flatMap((row) => {
        const subject = visible.get(row.subjectId);
        if (!subject || !shows(row)) return [];
        if (subject.from !== null && row.at.getTime() < subject.from.getTime()) return [];
        return [toAccessHistoryEntry(row, subject)];
      });
    });
  }
}

/** Whether the declarant sees an entry of this kind about this kind of subject. */
function shows(row: RegisterRow): boolean {
  switch (row.subjectKind) {
    case 'access-request':
      return FORM_K_VISIBLE_KINDS.includes(row.kind);
    case 'lea-request':
      return LEA_VISIBLE_KINDS.includes(row.kind);
    case 'self-access':
      return row.kind === 'self-access';
  }
}
