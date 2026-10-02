import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';

import { reviewCases } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { withUpstream } from '../internal-api/upstream.js';
import { systemContext } from '../system-context.js';
import { portalDecisionUrl } from './activities.js';
import { type DeterminationLetterPayload, OUTCOME_LABELS } from './representation.js';
import { determinations } from './schema.js';

/**
 * The letter payload the documents service pulls when it renders a decision letter
 * (`internalGetDeterminationLetterPayload`). Template fields only, of an approved determination:
 * the declarant's name, the references, the outcome and its reasons.
 */
@Injectable()
export class DeterminationLetterPayloadService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
  ) {}

  async payload(tenant: string, determinationId: string): Promise<DeterminationLetterPayload> {
    const [found] = await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .select({
          determination: determinations,
          declarationReference: reviewCases.reference,
          declarantName: reviewCases.declarantName,
        })
        .from(determinations)
        .innerJoin(reviewCases, eq(reviewCases.id, determinations.caseId))
        .where(and(eq(determinations.id, determinationId), eq(determinations.status, 'approved'))),
    );
    const { determination, declarationReference, declarantName } = notFoundIfInvisible(found);
    if (determination.reference === null || determination.approvedAt === null) {
      throw new Error(`Determination ${determinationId} is approved without a reference`);
    }
    const commission = await withUpstream(() => this.directory.getCommission(tenant));
    return {
      declarantName,
      commission: { name: commission.name, issuerCode: commission.issuerCode },
      declarationReference,
      determinationReference: determination.reference,
      outcome: determination.outcome,
      outcomeLabel: OUTCOME_LABELS[determination.outcome],
      reasons: determination.reasons,
      decidedAt: determination.approvedAt.toISOString(),
      portalUrl: portalDecisionUrl(determinationId),
    };
  }
}
