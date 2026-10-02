import { z } from 'zod';

import { LETTER_LANGUAGES, REQUIREMENTS } from '../cases/schema.js';

/** `bio`, `household`, `other` or `statement:<person key>` (declarations' section keys). */
const SECTION_KEY =
  /^(bio|household|other|statement:(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36}))$/;
const PERSON_KEY = /^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$/;

/** review.yaml `ClarificationItemInput`: what one item concerns and what s.35(4) requires. */
export const clarificationItemInput = z.object({
  sectionKey: z.string().regex(SECTION_KEY).nullish(),
  personKey: z.string().regex(PERSON_KEY).nullish(),
  itemId: z.uuid().nullish(),
  requirement: z.enum(REQUIREMENTS),
  text: z.string().trim().min(1).max(1000),
  /** The Draft with AI job that drafted the item (ADR-007), kept through the reviewer's edits. */
  aiJobId: z.uuid().nullish(),
});

/**
 * review.yaml `ClarificationInput`. A draft may have no items yet; issuing one needs at least
 * one. The opening paragraph is optional: left out or blank, the letter has none (and no job
 * drafted it). The letter's language, left out, is English.
 */
export const clarificationInput = z
  .object({
    items: z.array(clarificationItemInput).max(50),
    opening: z
      .string()
      .trim()
      .max(800)
      .nullish()
      .transform((opening) =>
        opening === undefined || opening === null || opening === '' ? null : opening,
      ),
    openingAiJobId: z.uuid().nullish(),
    language: z.enum(LETTER_LANGUAGES).default('en'),
  })
  .transform((input) => ({
    ...input,
    openingAiJobId: input.opening === null ? null : (input.openingAiJobId ?? null),
  }));

export type ClarificationInput = z.infer<typeof clarificationInput>;

export const uuidParam = z.uuid();

/** review.yaml `resolveClarification` body: the reviewer's note. */
export const resolutionInput = z.object({ note: z.string().trim().min(1).max(2000) });
export type ResolutionInput = z.infer<typeof resolutionInput>;

/** review.yaml `withdrawClarification` body: why it was issued in error. */
export const withdrawalInput = z.object({ reason: z.string().trim().min(1).max(1000) });
export type WithdrawalInput = z.infer<typeof withdrawalInput>;

/** review.yaml `ClarificationResponseInput`: the declarant's answers, by item position. */
export const responseInput = z.object({
  items: z
    .array(
      z.object({
        index: z.number().int().min(0),
        text: z.string().trim().min(1).max(2000),
        attachments: z.array(z.uuid()).max(10),
      }),
    )
    .min(1),
});
export type ResponseInput = z.infer<typeof responseInput>;
