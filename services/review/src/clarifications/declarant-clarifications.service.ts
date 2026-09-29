import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { clarificationResponses, clarifications, reviewCases } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { systemContext } from '../system-context.js';
import { withDirectory } from './clarifications.service.js';
import { letterDownloadUrl } from './links.js';
import { clarificationView, type DeclarantClarificationView } from './representation.js';

type ClarificationRow = typeof clarifications.$inferSelect;
type ResponseRow = typeof clarificationResponses.$inferSelect;

/**
 * The declarant's clarifications across Commissions (spec 07a): issued ones only, read under the
 * person's row-level security (`app.person`), never another person's. Drafts are the reviewer's
 * and stay invisible.
 */
@Injectable()
export class DeclarantClarificationsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
  ) {}

  async list(personId: string): Promise<DeclarantClarificationView[]> {
    const { rows, responses } = await this.read(personId);
    return this.views(rows, responses);
  }

  async get(personId: string, clarificationId: string): Promise<DeclarantClarificationView> {
    const { rows, responses } = await this.read(personId, clarificationId);
    const [view] = await this.views(rows, responses);
    return notFoundIfInvisible(view);
  }

  private read(personId: string, clarificationId?: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.person', ${personId}, true), set_config('app.subject', ${`person:${personId}`}, true)`,
      );
      const rows = await tx
        .select()
        .from(clarifications)
        .where(
          and(
            eq(clarifications.personId, personId),
            ne(clarifications.status, 'draft'),
            clarificationId === undefined ? undefined : eq(clarifications.id, clarificationId),
          ),
        )
        .orderBy(desc(clarifications.issuedAt));
      const responses =
        rows.length === 0
          ? []
          : await tx
              .select()
              .from(clarificationResponses)
              .where(
                inArray(
                  clarificationResponses.clarificationId,
                  rows.map((row) => row.id),
                ),
              );
      return { rows, responses };
    });
  }

  /**
   * Adds the Commission and the declaration reference. The cases are read as the service, per
   * Commission, and only those of the clarifications the person's own read returned.
   */
  private async views(
    rows: ClarificationRow[],
    responses: ResponseRow[],
  ): Promise<DeclarantClarificationView[]> {
    const references = new Map<string, string>();
    const names = new Map<string, string>();
    for (const tenant of new Set(rows.map((row) => row.tenant))) {
      const caseIds = rows.filter((row) => row.tenant === tenant).map((row) => row.caseId);
      const cases = await withTenant(this.db, systemContext(tenant), (tx) =>
        tx
          .select({ id: reviewCases.id, reference: reviewCases.reference })
          .from(reviewCases)
          .where(inArray(reviewCases.id, caseIds)),
      );
      for (const kase of cases) references.set(kase.id, kase.reference);
      const commission = await withDirectory(() => this.directory.getCommission(tenant));
      names.set(tenant, commission.name);
    }
    return rows.map((row) => {
      const view = clarificationView(
        row,
        responses.find((response) => response.clarificationId === row.id) ?? null,
      );
      return {
        ...view,
        commission: { slug: row.tenant, name: names.get(row.tenant) ?? row.tenant },
        declarationReference: references.get(row.caseId) ?? '',
        letterDownloadUrl:
          view.letter?.status === 'issued' ? letterDownloadUrl(view.letter.documentId) : null,
      };
    });
  }
}
