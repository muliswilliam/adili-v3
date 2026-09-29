import { z } from 'zod';

import { REQUIREMENTS } from '../cases/schema.js';

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
});

/**
 * review.yaml `ClarificationInput`. A draft may have no items yet; issuing one needs at least
 * one.
 */
export const clarificationInput = z.object({
  items: z.array(clarificationItemInput).max(50),
});

export type ClarificationInput = z.infer<typeof clarificationInput>;

export const uuidParam = z.uuid();
