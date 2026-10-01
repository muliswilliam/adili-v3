import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, count, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReviewSchema } from '../db/schema.js';
import { caseTenant } from './access.js';
import { findCase, visibleId } from './case-lookup.js';
import { type FlagReviewedData, REVIEW_FLAG_REVIEWED } from './events.js';
import { flagView, type FlagView, type NoteView } from './representation.js';
import { reviewCases, reviewFlags, reviewNotes, reviewTimeline } from './schema.js';

/**
 * What the Commission's reviewers and supervisors record on a case (spec 07a): internal notes,
 * which the declarant never sees, and a flag marked reviewed with the officer's conclusion. Each
 * is a timeline entry; a reviewed flag is also `review.flag.reviewed.v1`. Timeline summaries never
 * quote a note.
 */
@Injectable()
export class CaseAnnotationsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
  ) {}

  addNote(principal: Principal, caseId: string, text: string): Promise<NoteView> {
    const tenant = caseTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const row = await findCase(tx, tenant, caseId);
      const id = uuidv7();
      const at = new Date();
      await tx.insert(reviewNotes).values({
        id,
        tenant,
        caseId: row.id,
        author: principal.subject,
        authorName: principal.name,
        text,
        at,
      });
      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: row.id,
        kind: 'note-added',
        ref: id,
        actor: principal.subject,
        summary: 'Internal note added',
        at,
      });
      return {
        id,
        author: { subject: principal.subject, name: principal.name ?? principal.subject },
        text,
        at: at.toISOString(),
      };
    });
  }

  /** Marks the flag reviewed, once; the case's open-flag count is recounted. */
  markFlagReviewed(
    principal: Principal,
    caseId: string,
    flagId: string,
    note: string,
  ): Promise<FlagView> {
    const tenant = caseTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const row = await findCase(tx, tenant, caseId, { lock: true });
      const [found] = await tx
        .select()
        .from(reviewFlags)
        .where(and(eq(reviewFlags.id, visibleId(flagId)), eq(reviewFlags.caseId, row.id)));
      const flag = notFoundIfInvisible(found);
      if (flag.reviewedAt !== null) {
        throw new ProblemException({
          type: 'flag-already-reviewed',
          title: 'Flag already reviewed',
          status: HttpStatus.CONFLICT,
          detail: 'This flag was already marked reviewed; add a note to the case instead.',
        });
      }
      const at = new Date();
      const [reviewed] = await tx
        .update(reviewFlags)
        .set({ reviewedAt: at, reviewedBy: principal.subject, reviewNote: note })
        .where(eq(reviewFlags.id, flag.id))
        .returning();
      if (!reviewed) throw new Error(`The flag ${flag.id} disappeared under its case's lock`);

      const [open] = await tx
        .select({ count: count() })
        .from(reviewFlags)
        .where(and(eq(reviewFlags.caseId, row.id), isNull(reviewFlags.reviewedAt)));
      await tx
        .update(reviewCases)
        .set({ openFlags: open?.count ?? 0 })
        .where(eq(reviewCases.id, row.id));
      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: row.id,
        kind: 'flag-reviewed',
        ref: flag.id,
        actor: principal.subject,
        summary: `Flag reviewed: ${flag.title}`,
        at,
      });
      await this.events.record<FlagReviewedData>(tx, {
        type: REVIEW_FLAG_REVIEWED,
        subject: row.id,
        tenant,
        data: { caseId: row.id, flagId: flag.id, by: principal.subject },
      });
      return flagView(reviewed, (subject) => ({
        subject,
        name: principal.name ?? subject,
      }));
    });
  }
}
