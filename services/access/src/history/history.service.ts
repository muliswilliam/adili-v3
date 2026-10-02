import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '@adili/api-kit';
import { DATABASE, FieldCipher, withPerson } from '@adili/data-access';
import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';

import { declarantPersonId } from '../access.js';
import type { AccessDatabase } from '../db/database.js';
import { leaRequests } from '../lea/schema.js';
import type { RegisterRow } from '../register/access-register.js';
import { inTimeline, type TimelineRow } from '../register/representation.js';
import { accessRegister } from '../register/schema.js';
import { openFormK } from '../requests/form-k.js';
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
 * here on top. A request's entries are the declarant's by the request (resolved to them), not by
 * each entry's person: entries recorded before an officer with no account onboarded carry none
 * (spec 10 decision 2), and show once the request is linked to them.
 */
@Injectable()
export class HistoryService {
  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly cipher: FieldCipher,
  ) {}

  /**
   * The declarant's history, newest first. A Form K request's entries carry the purpose the
   * notice told them (its Form K is opened after the transaction) and its scope.
   */
  async list(principal: Principal): Promise<AccessHistoryEntry[]> {
    const personId = declarantPersonId(principal);
    const { entries, formKRows } = await this.read(principal, personId);
    const purposes = new Map(
      await Promise.all(
        formKRows.map(
          async (row) => [row.id, (await openFormK(this.cipher, row)).partIII.reason] as const,
        ),
      ),
    );
    return entries.map((entry) =>
      entry.subjectKind === 'access-request'
        ? { ...entry, purposeInGeneralTerms: purposes.get(entry.subjectId) ?? null }
        : entry,
    );
  }

  private read(principal: Principal, personId: string) {
    return withPerson(this.db, { personId, subject: principal.subject }, async (tx) => {
      const formKAbout = tx
        .select({ id: accessRequests.id })
        .from(accessRequests)
        .where(eq(accessRequests.resolvedPersonId, personId));
      const leaAbout = tx
        .select({ id: leaRequests.id })
        .from(leaRequests)
        .where(eq(leaRequests.resolvedPersonId, personId));
      const entries = await tx
        .select()
        .from(accessRegister)
        .where(
          or(
            eq(accessRegister.personId, personId),
            and(
              eq(accessRegister.subjectKind, 'access-request'),
              inArray(accessRegister.subjectId, formKAbout),
            ),
            and(
              eq(accessRegister.subjectKind, 'lea-request'),
              inArray(accessRegister.subjectId, leaAbout),
            ),
          ),
        )
        .orderBy(desc(accessRegister.at), desc(accessRegister.id));
      const ids = (kind: RegisterRow['subjectKind']) => [
        ...new Set(entries.filter((row) => row.subjectKind === kind).map((row) => row.subjectId)),
      ];
      const formK = ids('access-request');
      const lea = ids('lea-request');
      const copies = ids('self-access');

      const visible = new Map<string, HistorySubject & { from: Date | null }>();
      const formKRows: (typeof accessRequests.$inferSelect)[] = [];
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
            purposeInGeneralTerms: null,
            formKScope: {
              requested: row.scope,
              decided: row.decision !== null,
              granted: row.decision?.grantedScope ?? null,
            },
            packageKind: row.packageKind,
            from: row.notifiedAt,
          });
          formKRows.push(row);
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
            purposeInGeneralTerms: null,
            formKScope: null,
            packageKind: row.packageKind,
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
            purposeInGeneralTerms: null,
            formKScope: null,
            packageKind: null,
            from: null,
          });
        }
      }

      const shown = entries.flatMap((row) => {
        const subject = visible.get(row.subjectId);
        if (!subject || !shows(row)) return [];
        if (subject.from !== null && row.at.getTime() < subject.from.getTime()) return [];
        return [toAccessHistoryEntry(row, subject)];
      });
      const shownFormK = new Set(shown.map((entry) => entry.subjectId));
      return { entries: shown, formKRows: formKRows.filter((row) => shownFormK.has(row.id)) };
    });
  }
}

/** Whether the declarant sees an entry of this kind about this kind of subject. */
function shows(row: RegisterRow): row is TimelineRow {
  if (!inTimeline(row)) return false;
  switch (row.subjectKind) {
    case 'access-request':
      return FORM_K_VISIBLE_KINDS.includes(row.kind);
    case 'lea-request':
      return LEA_VISIBLE_KINDS.includes(row.kind);
    case 'self-access':
      return row.kind === 'self-access';
  }
}
