import { z } from 'zod';

import {
  CLARIFICATION_STATUSES,
  type ClarificationItem,
  type clarificationResponses,
  type clarifications,
  LETTER_LANGUAGES,
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

/** review.yaml `LetterLanguage`. */
export const letterLanguageSchema = z.enum(LETTER_LANGUAGES).meta({
  description:
    "The language of a clarification letter: English (`en`) or Swahili (`sw`). The letter's own text (heading, introduction, item labels, requirements, how to respond) is printed in it; the reviewer's text is printed as written.",
});

/** An item of a clarification as it shows it: what it concerns and what s.35(4) requires. */
export const clarificationItemSchema = z.object({
  sectionKey: z.string().nullable(),
  personKey: z.string().nullable(),
  itemId: z.uuid().nullable(),
  requirement: requirementSchema,
  text: z.string(),
  aiJobId: z.uuid().nullable().meta({
    description:
      'The Draft with AI job (`CopilotDraft.jobId`) that drafted the item, kept when the reviewer edits it (ADR-007: AI-assisted content stays labelled); null when the reviewer wrote it',
  }),
  aiLanguage: letterLanguageSchema.nullable().meta({
    description:
      "The language the item's Draft with AI job (`aiJobId`) drafted in, recorded on save; it may differ from the letter's `language` when that changed after. Null when the reviewer wrote the item.",
  }),
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
  opening: z.string().nullable().meta({
    description: "The letter's opening paragraph, printed before the items; null when it has none",
  }),
  openingAiJobId: z.uuid().nullable().meta({
    description:
      'The Draft with AI job that drafted the opening paragraph; null when written by the reviewer',
  }),
  openingAiLanguage: letterLanguageSchema.nullable().meta({
    description:
      "The language the opening's Draft with AI job drafted in; it may differ from the letter's `language` when that changed after. Null when written by the reviewer.",
  }),
  language: letterLanguageSchema,
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
  declarantPersonId: z.uuid().meta({
    description:
      'Who may download the letter: the documents service checks the issue request against it. Not printed',
  }),
  declarantName: z.string(),
  commission: z.object({ name: z.string(), issuerCode: z.string() }),
  declarationReference: z.string(),
  clarificationReference: z.string(),
  language: letterLanguageSchema.meta({
    description:
      "The template prints its own text (heading, introduction, how to respond, sign-off, the AI note and the verification lines) in this language. `items[].label` and `items[].requirementLabel` already are; the opening and the items' text are the reviewer's, printed as written. Letters issued before it was recorded are `en`.",
  }),
  opening: z.string().nullable().meta({
    description: 'Printed before the items; null when the letter has no opening paragraph',
  }),
  aiAssisted: z.boolean().meta({
    description:
      "Some of the letter's text (its opening or an item) was drafted with AI and approved by the reviewer who issued it (ADR-007); the letter says so. Once a save of the clarification names a Draft with AI job, it stays true, even if a later save leaves the job out.",
  }),
  items: z.array(
    z.object({
      label: z.string(),
      requirementLabel: z.string(),
      text: z.string(),
      aiAssisted: z.boolean().meta({
        description:
          'The item was drafted with AI (and possibly edited) before the reviewer issued it',
      }),
    }),
  ),
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
    opening: row.opening,
    openingAiJobId: row.openingAiJobId,
    openingAiLanguage: row.openingAiLanguage,
    language: row.language,
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
      aiJobId: item.aiJobId ?? null,
      aiLanguage: item.aiLanguage ?? null,
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
