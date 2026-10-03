import { z } from 'zod';

import type { AiLabel } from '../ai-gateway/ai-gateway-client.js';
import { completenessIssueSchema } from '../drafts/representation.js';
import { SECTION_KEY } from '../drafts/sections.js';
import { ITEM_TYPE_TAGS } from '../help/corpus.js';
import { helpLanguageSchema, helpPassageSchema } from '../help/representation.js';
import { QUESTION_THEMES } from './themes.js';

/**
 * Bodies of the assistant API (spec 11). They are the contract: the OpenAPI document,
 * packages/schemas/internal/declarations.yaml, is generated from them (`pnpm contracts`).
 */

export const openConversationRequestSchema = z.object({
  declarationId: z.uuid().nullable().meta({
    description:
      'The draft the declarant is working on; null for their conversation outside a draft (the dashboard)',
  }),
  language: helpLanguageSchema.meta({
    description: 'The language to answer in; switches a resumed conversation',
  }),
});

export type OpenConversationRequest = z.infer<typeof openConversationRequestSchema>;

export const askRequestSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  sectionKey: z.string().regex(SECTION_KEY).nullable().meta({
    description: 'The section of the draft the declarant is on; ignored outside a draft',
  }),
  itemType: z.enum(ITEM_TYPE_TAGS).nullable().optional().meta({
    description: 'The statement item type the declarant is on; passages about it rank higher',
  }),
});

export type AskRequest = z.infer<typeof askRequestSchema>;

export const sectionLinkSchema = z
  .object({
    sectionKey: z.string().regex(SECTION_KEY),
    fieldPath: z.string().nullable().meta({ description: 'JSON pointer within the section' }),
  })
  .meta({ description: 'Where in the draft the answer is about: a section of it, and a field' });

/** ai-gateway.yaml `AiLabel`: an AI-assisted answer, not legal advice. */
export const aiLabelSchema = z
  .object({
    aiAssisted: z.literal(true),
    task: z.literal('answer-declarant-question'),
    promptVersion: z.int(),
    provider: z.string(),
    model: z.string(),
    generatedAt: z.iso.datetime({ offset: true }),
    disclaimer: z.string().meta({ description: 'Fixed text per language: not legal advice' }),
  })
  .meta({
    description: 'Labels an answer from the AI: AI-assisted, which model, not legal advice',
  }) satisfies z.ZodType<AiLabel>;

export const reportingOfficerContactSchema = z
  .object({
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
  })
  .meta({
    description:
      "The Commission's reporting officer, whom a declined answer sends the declarant to",
  });

export type ReportingOfficerContact = z.infer<typeof reportingOfficerContactSchema>;

export const assistantMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string().meta({
    description:
      "The question, or the answer's paragraphs separated by a blank line; for a declined answer, the decline in the conversation's language",
  }),
  citations: z.array(helpPassageSchema).meta({
    description:
      'The passages the answer rests on, all retrieved for it; empty for a question or a decline',
  }),
  sectionLink: sectionLinkSchema.nullable(),
  declined: z.boolean().meta({
    description: 'The Act, Regulations and help articles retrieved do not support an answer',
  }),
  reportingOfficer: reportingOfficerContactSchema.nullable().meta({
    description:
      'On a declined answer, whom to ask instead; null when the Commission has none on record',
  }),
  label: aiLabelSchema.nullable().meta({
    description:
      'How an answer from the AI is labelled (ai-gateway AiLabel); null for a question, and for a decline made without asking the AI',
  }),
  rating: z.enum(['helpful', 'not-helpful']).nullable(),
  at: z.iso.datetime({ offset: true }),
});

export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const assistantConversationSchema = z.object({
  id: z.uuid(),
  declarationId: z.uuid().nullable(),
  language: helpLanguageSchema,
  messages: z.array(assistantMessageSchema).meta({ description: 'Oldest first' }),
  expiresAt: z.iso.datetime({ offset: true }).nullable().meta({
    description:
      'When a conversation outside a draft is deleted (30 days after its last message); null for a draft, whose conversation goes with it',
  }),
});

export type AssistantConversation = z.infer<typeof assistantConversationSchema>;

/** The `final` server-sent event of an answer: both turns as stored. */
export const assistantAnswerSchema = z.object({
  question: assistantMessageSchema,
  answer: assistantMessageSchema,
});

export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;

/** Why an answer did not help: the ai-gateway's `FeedbackInput.reason`, forwarded. */
export const FEEDBACK_REASONS = [
  'inaccurate',
  'missed-something',
  'unclear',
  'too-long',
  'other',
] as const;

export const rateMessageRequestSchema = z.object({
  rating: z.enum(['helpful', 'not-helpful']),
  reason: z.enum(FEEDBACK_REASONS).nullable(),
  note: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((note) => (note === undefined || note === null || note === '' ? null : note))
    .meta({ description: "The declarant's own words; kept encrypted, sent to the AI gateway" }),
});

export type RateMessageRequest = z.infer<typeof rateMessageRequestSchema>;

export const hintsQuery = z.object({
  language: helpLanguageSchema.meta({ description: 'The language of the hints' }),
});

export type HintsQuery = z.infer<typeof hintsQuery>;

export const completenessHintSchema = completenessIssueSchema.extend({
  hint: z.string().nullable().meta({
    description:
      'An AI-assisted plain-language hint for the residual, beneath its deterministic `message`; null when there is none',
  }),
});

export type CompletenessHint = z.infer<typeof completenessHintSchema>;

export const completenessHintsSchema = z.object({
  status: z.enum(['ready', 'pending', 'unavailable']).meta({
    description:
      '`ready`: every hint the AI wrote is here (none when nothing is left to complete). `pending`: still being written; ask again shortly. `unavailable`: no AI now, the deterministic text only',
  }),
  label: aiLabelSchema.nullable().meta({ description: 'How the hints are labelled; null without' }),
  residuals: z.array(completenessHintSchema).meta({
    description: "The summary's `blocking`, in its order, each with its hint",
  }),
});

export type CompletenessHints = z.infer<typeof completenessHintsSchema>;

export const questionThemeSchema = z.enum(QUESTION_THEMES).meta({
  description:
    "The fixed list of question themes; `other` for a question no rule matches. A label per theme is the console's",
});

export const themesQuery = z.object({
  month: z
    .string()
    .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .meta({ description: 'One month (`YYYY-MM`, Nairobi); every month when left out' }),
});

export type ThemesQuery = z.infer<typeof themesQuery>;

export const questionThemeCountSchema = z.object({
  month: z.string().meta({ description: '`YYYY-MM`, Nairobi' }),
  theme: questionThemeSchema,
  count: z.int().min(1).meta({ description: 'Questions asked and answered (or declined)' }),
  unanswered: z.int().min(0).meta({
    description: 'Of them, those the Act, Regulations and help articles could not answer',
  }),
});

export type QuestionThemeCount = z.infer<typeof questionThemeCountSchema>;
