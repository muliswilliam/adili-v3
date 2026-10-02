import type { DeclarationV1 } from '@adili/forms';

import type { ClarificationItem, ClarificationLetter } from '../cases/schema.js';
import {
  type DeclarationsClient,
  DeclarationsUnavailable,
  type ReadContext,
} from '../declarations/declarations-client.js';
import type { CommissionFacts } from '../directory/directory-client.js';
import { declarationsUnavailable } from '../internal-api/upstream.js';
import { itemLabel, REQUIREMENT_LABELS } from './labels.js';

/** The case a clarification is issued on: its current version as filed labels the items. */
export interface LetterCase {
  id: string;
  declarationId: string;
  currentVersion: number;
}

/**
 * The letter of a clarification being issued: its opening paragraph, and each item labelled from
 * the case's current version as filed, read from declarations on the reviewer's behalf (audited
 * there), each marked when drafted with AI (ADR-007). A declarations outage is a 502: nothing is
 * issued, and the reviewer issues again.
 */
export async function composeLetter(
  declarations: DeclarationsClient,
  read: Omit<ReadContext, 'caseId'>,
  reviewCase: LetterCase,
  commission: CommissionFacts,
  {
    items,
    opening,
    openingAiJobId,
  }: { items: ClarificationItem[]; opening: string | null; openingAiJobId: string | null },
): Promise<ClarificationLetter> {
  let document: DeclarationV1 | null;
  try {
    const pulled = await declarations.getVersionDocument(
      reviewCase.declarationId,
      reviewCase.currentVersion,
      { ...read, caseId: reviewCase.id },
    );
    document = (pulled?.document as unknown as DeclarationV1 | undefined) ?? null;
  } catch (error) {
    if (!(error instanceof DeclarationsUnavailable)) throw error;
    throw declarationsUnavailable();
  }
  const lines = items.map((item) => ({
    label: itemLabel(item, document),
    requirementLabel: REQUIREMENT_LABELS[item.requirement],
    text: item.text,
    aiAssisted: item.aiJobId != null,
  }));
  return {
    commission: { name: commission.name, issuerCode: commission.issuerCode },
    opening,
    aiAssisted: (opening !== null && openingAiJobId !== null) || lines.some((l) => l.aiAssisted),
    items: lines,
  };
}
