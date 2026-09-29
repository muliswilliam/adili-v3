import { z } from 'zod';

import { SECTION_KEY } from '../drafts/sections.js';
import { CORPUS_TAGS, type CorpusTag } from './corpus.js';
import { CORPUS_SOURCE_VALUES } from './schema.js';

/**
 * Bodies of the help API (spec 11). They are the contract: the OpenAPI document,
 * packages/schemas/internal/declarations.yaml, is generated from them (`pnpm contracts`).
 */

/** The statement item types a passage or article may be tagged with, for boosts. */
export const ITEM_TYPE_TAGS = [
  'land',
  'building',
  'vehicle',
  'securities',
  'shareholding',
  'bank-account',
  'cash',
  'receivable',
  'mortgage',
  'loan',
  'guarantee',
  'salary-emoluments',
  'allowances',
  'business',
  'rent',
  'dividends-interest',
  'pension',
  'farming',
  'consultancy',
] as const satisfies readonly CorpusTag[];

export const helpLanguageSchema = z.enum(['en', 'sw']);

export const helpTagSchema = z.enum(CORPUS_TAGS).meta({
  description:
    'A section kind (bio, household, statement, other), a statement item type or a topic of the corpus',
});

const isoDate = z.iso.date();

/** Query of `GET /v1/help/search`. */
export const helpSearchQuery = z.object({
  q: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .meta({ description: "The question, in the declarant's words" }),
  language: helpLanguageSchema.meta({
    description:
      'The language of the question: `sw` also searches Swahili article bodies and expands Swahili words into the English of the law',
  }),
  sectionKey: z
    .string()
    .regex(SECTION_KEY)
    .optional()
    .meta({ description: 'The section the declarant is on; passages tagged with it rank higher' }),
  itemType: z
    .enum(ITEM_TYPE_TAGS)
    .optional()
    .meta({ description: 'The statement item type the declarant is on; boosted like the section' }),
  date: isoDate
    .optional()
    .meta({ description: 'Read the law in force on this day (`YYYY-MM-DD`); today by default' }),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export type HelpSearchQuery = z.infer<typeof helpSearchQuery>;

export const helpPassageSchema = z.object({
  id: z.string().meta({ description: 'The corpus passage or help article id' }),
  source: z.enum([...CORPUS_SOURCE_VALUES, 'help']),
  citation: z.string().meta({ examples: ['Act s.31', 'Regs r.21', 'Help: File numbers'] }),
  title: z.string(),
  snippet: z.string().meta({ description: 'The passage text around the matched words' }),
  language: helpLanguageSchema.meta({ description: 'The language of the snippet' }),
});

export type HelpPassage = z.infer<typeof helpPassageSchema>;

export const helpArticleInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    bodyEn: z.string().trim().min(1).max(20_000),
    bodySw: z.string().trim().min(1).max(20_000).nullable(),
    tags: z.array(helpTagSchema).max(20),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().meta({ description: 'Exclusive; null while in force' }),
    published: z.boolean(),
  })
  .refine(({ effectiveFrom, effectiveTo }) => effectiveTo === null || effectiveTo > effectiveFrom, {
    path: ['effectiveTo'],
    message: 'must be after effectiveFrom',
  });

export type HelpArticleInput = z.infer<typeof helpArticleInputSchema>;

export const helpArticleSchema = z.object({
  id: z.uuid(),
  tenant: z
    .string()
    .nullable()
    .meta({ description: "The Commission's slug; null for the platform" }),
  title: z.string(),
  bodyEn: z.string(),
  bodySw: z.string().nullable(),
  tags: z.array(helpTagSchema),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable(),
  published: z.boolean(),
  version: z.int().meta({ description: 'Counts saves' }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type HelpArticle = z.infer<typeof helpArticleSchema>;

export const corpusPassageSchema = z.object({
  id: z.uuid(),
  source: z.enum(CORPUS_SOURCE_VALUES),
  citation: z.string(),
  title: z.string(),
  tags: z.array(helpTagSchema),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().meta({ description: 'Exclusive; null while current' }),
  version: z.string().meta({ description: 'The corpus version that last wrote the passage' }),
});

export type CorpusPassageView = z.infer<typeof corpusPassageSchema>;

export const corpusImportResultSchema = z.object({
  version: z.string().meta({ description: 'A hash of the corpus files' }),
  skipped: z.boolean().meta({ description: 'The version was imported already; nothing changed' }),
  inserted: z.int(),
  updated: z.int(),
  removed: z.int(),
  unchanged: z.int(),
});

export type CorpusImportResult = z.infer<typeof corpusImportResultSchema>;
