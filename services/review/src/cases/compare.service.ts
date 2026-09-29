import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import type { DeclarationV1 } from '@adili/forms';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { ReviewSchema } from '../db/schema.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type PulledVersion,
  type ReadContext,
} from '../declarations/declarations-client.js';
import { declarationsUnavailable } from '../internal-api/upstream.js';
import { reviewTenant } from './access.js';
import { compareVersions, type VersionComparison } from './comparison.js';
import { reviewCases } from './schema.js';

const caseIdSchema = z.uuid();

/**
 * The reviewer's comparison of a case's current version with the person's previous submitted
 * version at the Commission (spec 07a). Both documents are pulled from declarations for every
 * call, as the caller and for the case, so declarations audits each read; nothing is kept. Only
 * the Commission's reviewers and supervisors see a case; everyone else gets 404.
 */
@Injectable()
export class CompareService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly declarations: DeclarationsClient,
  ) {}

  async compare(principal: Principal, caseId: string): Promise<VersionComparison> {
    const tenant = notFoundIfInvisible(reviewTenant(principal));
    const found = caseIdSchema.safeParse(caseId).success
      ? await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
          const [row] = await tx
            .select({
              declarationId: reviewCases.declarationId,
              currentVersionId: reviewCases.currentVersionId,
              currentVersion: reviewCases.currentVersion,
              personId: reviewCases.personId,
            })
            .from(reviewCases)
            .where(and(eq(reviewCases.id, caseId), eq(reviewCases.tenant, tenant)));
          return row;
        })
      : undefined;
    const reviewCase = notFoundIfInvisible(found);
    const context: ReadContext = { tenant, actingSubject: principal.subject, caseId };

    try {
      const previous = await this.declarations.findPreviousVersion(
        reviewCase.personId,
        tenant,
        reviewCase.currentVersionId,
      );
      if (!previous) {
        throw new ProblemException({
          type: 'no-previous-version',
          title: 'No previous version',
          status: HttpStatus.CONFLICT,
          detail:
            "This is the declarant's first declaration on Adili; there is nothing to compare.",
        });
      }
      const current = await this.pull(reviewCase.declarationId, reviewCase.currentVersion, context);
      const before = await this.pull(previous.declarationId, previous.version, context);
      return compareVersions(
        { version: before.version, document: before.document as unknown as DeclarationV1 },
        { version: current.version, document: current.document as unknown as DeclarationV1 },
      );
    } catch (error) {
      if (error instanceof DeclarationsUnavailable) throw declarationsUnavailable();
      throw error;
    }
  }

  /** A version the case refers to; one declarations no longer gives is an upstream fault. */
  private async pull(
    declarationId: string,
    version: number,
    context: ReadContext,
  ): Promise<PulledVersion> {
    const pulled = await this.declarations.getVersionDocument(declarationId, version, context);
    if (!pulled) throw declarationsUnavailable();
    return pulled;
  }
}
