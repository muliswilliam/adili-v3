import { z } from 'zod';

import { SECTION_KEY } from '../drafts/sections.js';
import { ITEM_TYPE_TAGS } from '../help/corpus.js';
import { helpLanguageSchema, helpPassageSchema } from '../help/representation.js';

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
  label: z.record(z.string(), z.unknown()).nullable().meta({
    description: 'ai-gateway AiLabel for assistant turns from the AI; null for a question',
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
