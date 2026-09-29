import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import type { DeclarationV1 } from '@adili/forms';
import { and, eq, ne } from 'drizzle-orm';

import { clarifications, reviewCases } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
} from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { declarationsUnavailable, withUpstream } from '../internal-api/upstream.js';
import { SYSTEM_SUBJECT, systemContext } from '../system-context.js';
import { itemLabel, REQUIREMENT_LABELS } from './labels.js';
import { portalClarificationUrl } from './links.js';

/** review.yaml `ClarificationLetterPayload`: the fields `clarification-letter.v1` renders. */
export interface ClarificationLetterPayload {
  declarantName: string;
  commission: { name: string; issuerCode: string };
  declarationReference: string;
  clarificationReference: string;
  items: { label: string; requirementLabel: string; text: string }[];
  issuedAt: string;
  dueAt: string;
  portalUrl: string;
}

/**
 * The letter payload the documents service pulls when it renders a clarification letter
 * (`internalGetClarificationLetterPayload`). Template fields only: no ids, person ids, amounts or
 * anything else of the declaration beyond the labels of the items asked about. The labels are
 * read from the declaration as filed, pulled for the case and audited by declarations; nothing is
 * kept.
 */
@Injectable()
export class LetterPayloadService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly declarations: DeclarationsClient,
    private readonly directory: DirectoryClient,
  ) {}

  async payload(tenant: string, clarificationId: string): Promise<ClarificationLetterPayload> {
    const found = await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [clarification] = await tx
        .select()
        .from(clarifications)
        .where(and(eq(clarifications.id, clarificationId), ne(clarifications.status, 'draft')));
      if (!clarification) return null;
      const [reviewCase] = await tx
        .select({
          id: reviewCases.id,
          declarationId: reviewCases.declarationId,
          currentVersion: reviewCases.currentVersion,
          reference: reviewCases.reference,
          declarantName: reviewCases.declarantName,
        })
        .from(reviewCases)
        .where(eq(reviewCases.id, clarification.caseId));
      return reviewCase ? { clarification, reviewCase } : null;
    });
    const { clarification, reviewCase } = notFoundIfInvisible(found);
    if (!clarification.reference || !clarification.issuedAt || !clarification.dueAt) {
      throw new Error(`Clarification ${clarificationId} is issued without a reference`);
    }

    const commission = await withUpstream(() => this.directory.getCommission(tenant));
    const document = await this.document(tenant, reviewCase);
    return {
      declarantName: reviewCase.declarantName,
      commission: { name: commission.name, issuerCode: commission.issuerCode },
      declarationReference: reviewCase.reference,
      clarificationReference: clarification.reference,
      items: clarification.items.map((item) => ({
        label: itemLabel(item, document),
        requirementLabel: REQUIREMENT_LABELS[item.requirement],
        text: item.text,
      })),
      issuedAt: clarification.issuedAt.toISOString(),
      dueAt: clarification.dueAt.toISOString(),
      portalUrl: portalClarificationUrl(clarificationId),
    };
  }

  /** The case's current version as filed; an outage is a 502 documents retries. */
  private async document(
    tenant: string,
    reviewCase: { id: string; declarationId: string; currentVersion: number },
  ): Promise<DeclarationV1 | null> {
    try {
      const pulled = await this.declarations.getVersionDocument(
        reviewCase.declarationId,
        reviewCase.currentVersion,
        { tenant, actingSubject: SYSTEM_SUBJECT, caseId: reviewCase.id },
      );
      return (pulled?.document as unknown as DeclarationV1 | undefined) ?? null;
    } catch (error) {
      if (!(error instanceof DeclarationsUnavailable)) throw error;
      throw declarationsUnavailable();
    }
  }
}
