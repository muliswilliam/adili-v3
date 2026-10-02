import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { reviewCases } from '../cases/schema.js';
import { asPerson } from '../clarifications/declarant-clarifications.service.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { withUpstream } from '../internal-api/upstream.js';
import { systemContext } from '../system-context.js';
import type { DeclarantDecisionView } from './representation.js';
import { determinations } from './schema.js';

/**
 * The declarant's decisions across Commissions (spec 08): approved determinations only, read under
 * the person's row-level security (`app.person`). A proposal is the Commission's until approved.
 */
@Injectable()
export class DeclarantDecisionsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
  ) {}

  async list(personId: string): Promise<DeclarantDecisionView[]> {
    const rows = await this.db.transaction(async (tx) => {
      await asPerson(tx, personId);
      return tx
        .select()
        .from(determinations)
        .where(and(eq(determinations.personId, personId), eq(determinations.status, 'approved')))
        .orderBy(desc(determinations.approvedAt));
    });
    // The declaration references and Commission names, read as the service per Commission, for
    // the cases of the person's own determinations only.
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
      for (const reviewCase of cases) references.set(reviewCase.id, reviewCase.reference);
      const commission = await withUpstream(() => this.directory.getCommission(tenant));
      names.set(tenant, commission.name);
    }
    return rows.flatMap((row) =>
      row.reference === null || row.approvedAt === null
        ? []
        : [
            {
              determinationId: row.id,
              declarationReference: references.get(row.caseId) ?? '',
              commission: { slug: row.tenant, name: names.get(row.tenant) ?? row.tenant },
              outcome: row.outcome,
              decidedAt: row.approvedAt.toISOString(),
              reference: row.reference,
              letterAvailable: row.letterDocumentId !== null,
            },
          ],
    );
  }
}
