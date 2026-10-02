import { z } from 'zod';

import {
  CLARIFICATION_STATUSES,
  type ClarificationItem,
  type clarificationResponses,
  type clarifications,
  REQUIREMENTS,
} from '../cases/schema.js';

/**
 * Bodies of the clarifications API (spec 07a). They are the contract: the OpenAPI document,
 * packages/schemas/internal/review.yaml, is generated from them (`pnpm contracts`).
 */

type ClarificationRow = typeof clarifications.$inferSelect;
type ResponseRow = typeof clarificationResponses.$inferSelect;

/** The most clarification ids one details request carries (reporting pages by it). */
export const CLARIFICATION_DETAILS_PAGE = 1_000;

export const clarificationDetailsRequest = z.object({
  clarificationIds: z.array(z.uuid()).min(1).max(CLARIFICATION_DETAILS_PAGE),
});
export type ClarificationDetailsRequest = z.infer<typeof clarificationDetailsRequest>;

/** review.yaml `InternalClarificationDetails`: Form M section 4's row of a clarification. */
export const clarificationDetailsSchema = z.object({
  clarificationId: z.uuid(),
  reference: z.string().nullable().meta({ description: '`CLR-...`; null for one never issued' }),
  name: z.string(),
  designation: z.string(),
  identifier: z
    .string()
    .meta({ description: 'Personnel file number, or another staff, ID or passport number' }),
  requirementLabels: z
    .array(z.string())
    .meta({ description: 'Labels of the requirement kinds asked for, e.g. "Source of income"' }),
});
export type ClarificationDetails = z.infer<typeof clarificationDetailsSchema>;

/** review.yaml `ClarificationStatus`. */
export const clarificationStatusSchema = z.enum(CLARIFICATION_STATUSES);

/** review.yaml `Requirement`. */
export const requirementSchema = z.enum(REQUIREMENTS).meta({ description: 'Act s.35(4)' });

/** An item of a clarification as it shows it: what it concerns and what s.35(4) requires. */
export const clarificationItemSchema = z.object({
  sectionKey: z.string().nullable(),
  personKey: z.string().nullable(),
  itemId: z.uuid().nullable(),
  requirement: requirementSchema,
  text: z.string(),
  label: z.string().optional().meta({
    description:
      'Human label of the target (e.g. "Assets · Plot KSM/123 · Grace Otieno"), as the letter names it; absent while a draft',
  }),
});
export type ClarificationItemView = z.infer<typeof clarificationItemSchema>;

/** review.yaml `Clarification`. */
export const clarificationSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  reference: z
    .string()
    .nullable()
    .meta({ description: 'CLR-<ISSUER>-<YEAR>-<seq>-<check>; null while draft' }),
  status: clarificationStatusSchema,
  items: z.array(clarificationItemSchema),
  issuedAt: z.iso.datetime().nullable(),
  dueAt: z.iso.datetime().nullable(),
  respondedAt: z.iso.datetime().nullable(),
  responseLate: z.boolean(),
  resolvedAt: z.iso.datetime().nullable(),
  resolutionNote: z.string().nullable(),
  letter: z
    .object({
      documentId: z.uuid(),
      verificationId: z.string(),
      status: z.enum(['pending', 'issued', 'revoked']),
    })
    .nullable(),
  followUpOf: z.uuid().nullable(),
  response: z
    .object({
      items: z.array(
        z.object({
          index: z.int(),
          text: z.string(),
          attachments: z.array(
            z.object({ uploadId: z.uuid(), fileName: z.string(), sha256: z.string() }),
          ),
        }),
      ),
      submittedAt: z.iso.datetime(),
    })
    .nullable(),
});
export type ClarificationView = z.infer<typeof clarificationSchema>;

/** review.yaml `DeclarantClarification`: the declarant's view, with the letter link. */
export const declarantClarificationSchema = clarificationSchema.extend({
  commission: z.object({ slug: z.string(), name: z.string() }),
  declarationReference: z.string(),
  letterDownloadUrl: z.url().nullable(),
});
export type DeclarantClarificationView = z.infer<typeof declarantClarificationSchema>;

/** review.yaml `ClarificationLetterPayload`: the fields `clarification-letter.v1` renders. */
export const clarificationLetterPayloadSchema = z.object({
  declarantName: z.string(),
  commission: z.object({ name: z.string(), issuerCode: z.string() }),
  declarationReference: z.string(),
  clarificationReference: z.string(),
  items: z.array(z.object({ label: z.string(), requirementLabel: z.string(), text: z.string() })),
  issuedAt: z.iso.datetime(),
  dueAt: z.iso.datetime(),
  portalUrl: z.url(),
});
export type ClarificationLetterPayload = z.infer<typeof clarificationLetterPayloadSchema>;

export function clarificationView(
  row: ClarificationRow,
  response: ResponseRow | null = null,
): ClarificationView {
  return {
    id: row.id,
    caseId: row.caseId,
    reference: row.reference,
    status: row.status,
    items: clarificationItems(row),
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
    response: response === null ? null : responseView(row.items, response),
  };
}

/**
 * A clarification's items as it shows them, labelled as its letter names them once issued (the
 * letter, fixed at issue, lists the items in order).
 */
export function clarificationItems(row: ClarificationRow): ClarificationItemView[] {
  return row.items.map((item, index) => {
    const label = row.letter?.items[index]?.label;
    return {
      sectionKey: item.sectionKey,
      personKey: item.personKey,
      itemId: item.itemId,
      requirement: item.requirement,
      text: item.text,
      ...(label === undefined ? {} : { label }),
    };
  });
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
