import type {
  ClarificationItem,
  ClarificationStatus,
  clarificationResponses,
  clarifications,
  LetterLanguage,
} from '../cases/schema.js';
import { z } from 'zod';

import type { Requirement } from './labels.js';

type ClarificationRow = typeof clarifications.$inferSelect;
type ResponseRow = typeof clarificationResponses.$inferSelect;

/** The most clarification ids one details request carries (reporting pages by it). */
export const CLARIFICATION_DETAILS_PAGE = 1_000;

export const clarificationDetailsRequest = z.object({
  clarificationIds: z.array(z.uuid()).min(1).max(CLARIFICATION_DETAILS_PAGE),
});
export type ClarificationDetailsRequest = z.infer<typeof clarificationDetailsRequest>;

/** review.yaml `InternalClarificationDetails`: Form M section 4's row of a clarification. */
export interface ClarificationDetails {
  clarificationId: string;
  reference: string | null;
  name: string;
  designation: string;
  identifier: string;
  requirementLabels: string[];
}

/** review.yaml `ClarificationItemInput`, as a clarification shows its items. */
export interface ClarificationItemView {
  sectionKey: string | null;
  personKey: string | null;
  itemId: string | null;
  requirement: Requirement;
  text: string;
  /** The Draft with AI job that drafted the item; null when the reviewer wrote it. */
  aiJobId: string | null;
  /** The language that job drafted in; null when the reviewer wrote it or it is not known. */
  aiLanguage: LetterLanguage | null;
}

/** review.yaml `Clarification`. */
export interface ClarificationView {
  id: string;
  caseId: string;
  reference: string | null;
  status: ClarificationStatus;
  items: ClarificationItemView[];
  issuedAt: string | null;
  dueAt: string | null;
  respondedAt: string | null;
  responseLate: boolean;
  resolvedAt: string | null;
  resolutionNote: string | null;
  letter: { documentId: string; verificationId: string; status: 'issued' | 'revoked' } | null;
  followUpOf: string | null;
  /** The letter's opening paragraph, before the items; null when it has none. */
  opening: string | null;
  /** The Draft with AI job that drafted the opening paragraph; null when the reviewer wrote it. */
  openingAiJobId: string | null;
  /** The language that job drafted the opening in; null when not drafted or not known. */
  openingAiLanguage: LetterLanguage | null;
  /** The letter's language (review.yaml `LetterLanguage`). */
  language: LetterLanguage;
  response: {
    items: {
      index: number;
      text: string;
      attachments: { uploadId: string; fileName: string; sha256: string }[];
    }[];
    submittedAt: string;
  } | null;
}

/** review.yaml `DeclarantClarification`: the declarant's view, with the letter link. */
export interface DeclarantClarificationView extends ClarificationView {
  commission: { slug: string; name: string };
  declarationReference: string;
  letterDownloadUrl: string | null;
}

export function clarificationView(
  row: ClarificationRow,
  response: ResponseRow | null = null,
): ClarificationView {
  return {
    id: row.id,
    caseId: row.caseId,
    reference: row.reference,
    status: row.status,
    items: row.items.map(itemView),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    responseLate: row.responseLate ?? false,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionNote: row.resolutionNote,
    letter:
      row.letterDocumentId === null || row.letterVerificationId === null
        ? null
        : {
            documentId: row.letterDocumentId,
            verificationId: row.letterVerificationId,
            // A withdrawn clarification's letter is revoked as issued in error (#174).
            status: row.status === 'withdrawn' ? 'revoked' : 'issued',
          },
    followUpOf: row.followUpOf,
    opening: row.opening,
    openingAiJobId: row.openingAiJobId,
    openingAiLanguage: row.openingAiLanguage,
    language: row.language,
    response: response === null ? null : responseView(row.items, response),
  };
}

function itemView(item: ClarificationItem): ClarificationItemView {
  return {
    sectionKey: item.sectionKey,
    personKey: item.personKey,
    itemId: item.itemId,
    requirement: item.requirement,
    text: item.text,
    aiJobId: item.aiJobId ?? null,
    aiLanguage: item.aiLanguage ?? null,
  };
}

/** The stored answers, keyed by item id, as the contract's answers by item position. */
function responseView(
  items: ClarificationItem[],
  response: ResponseRow,
): NonNullable<ClarificationView['response']> {
  const indexOf = (itemId: string) => items.findIndex((item) => item.id === itemId);
  return {
    items: response.items.map((answer) => ({
      index: indexOf(answer.itemId),
      text: answer.text,
      attachments: response.attachments
        .filter((attachment) => attachment.itemId === answer.itemId)
        .map(({ uploadId, fileName, sha256 }) => ({ uploadId, fileName, sha256 })),
    })),
    submittedAt: response.submittedAt.toISOString(),
  };
}
