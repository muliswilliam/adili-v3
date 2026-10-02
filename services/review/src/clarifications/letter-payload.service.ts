import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq, ne } from 'drizzle-orm';

import { clarifications, type LetterLanguage, reviewCases } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import { systemContext } from '../system-context.js';
import { portalClarificationUrl } from './links.js';

/** review.yaml `ClarificationLetterPayload`: the fields `clarification-letter.v1` renders. */
export interface ClarificationLetterPayload {
  declarantName: string;
  commission: { name: string; issuerCode: string };
  declarationReference: string;
  clarificationReference: string;
  /** The template prints its own text in it; labels and requirements already are. */
  language: LetterLanguage;
  opening: string | null;
  /** Some of the text was drafted with AI and approved by the issuing reviewer (ADR-007). */
  aiAssisted: boolean;
  items: { label: string; requirementLabel: string; text: string; aiAssisted: boolean }[];
  issuedAt: string;
  dueAt: string;
  portalUrl: string;
}

/**
 * The letter payload the documents service pulls when it renders a clarification letter
 * (`internalGetClarificationLetterPayload`). Template fields only: no ids, person ids, amounts or
 * anything else of the declaration beyond the labels of the items asked about. Served from the
 * letter fixed when the clarification was issued, so rendering calls no other service (ADR-013
 * §7.3) and a letter reads the same whenever it is rendered.
 */
@Injectable()
export class LetterPayloadService {
  constructor(@InjectDatabase() private readonly db: Database<ReviewSchema>) {}

  async payload(tenant: string, clarificationId: string): Promise<ClarificationLetterPayload> {
    const found = await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [row] = await tx
        .select({
          reference: clarifications.reference,
          letter: clarifications.letter,
          issuedAt: clarifications.issuedAt,
          dueAt: clarifications.dueAt,
          declarationReference: reviewCases.reference,
          declarantName: reviewCases.declarantName,
        })
        .from(clarifications)
        .innerJoin(reviewCases, eq(reviewCases.id, clarifications.caseId))
        .where(and(eq(clarifications.id, clarificationId), ne(clarifications.status, 'draft')));
      return row ?? null;
    });
    const { reference, letter, issuedAt, dueAt, declarationReference, declarantName } =
      notFoundIfInvisible(found);
    if (!reference || !letter || !issuedAt || !dueAt) {
      throw new Error(`Clarification ${clarificationId} is issued without its letter`);
    }
    return {
      declarantName,
      commission: letter.commission,
      declarationReference,
      clarificationReference: reference,
      // Letters issued before the language was recorded are English.
      language: letter.language ?? 'en',
      opening: letter.opening ?? null,
      // Letters issued before the label was recorded had no AI-drafted text to mark.
      aiAssisted: letter.aiAssisted ?? false,
      items: letter.items.map((item) => ({ ...item, aiAssisted: item.aiAssisted ?? false })),
      issuedAt: issuedAt.toISOString(),
      dueAt: dueAt.toISOString(),
      portalUrl: portalClarificationUrl(clarificationId),
    };
  }
}
