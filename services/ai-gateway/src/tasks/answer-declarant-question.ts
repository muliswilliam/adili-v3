import { z } from 'zod';

import { language } from './common.js';
import { defineTask, type OutputViolation } from './task.js';

/** A declaration section: `bio`, `household`, `other` or one person's `statement:<personKey>`. */
const sectionKey = z
  .string()
  .regex(/^(bio|household|other|statement:(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36}))$/)
  .meta({ description: 'bio, household, other, or statement:<personKey> (declarations.yaml)' });

const fieldPath = z.string().max(200).meta({ description: 'JSON pointer within the section' });

const residual = z.object({
  sectionKey,
  ruleId: z.string().max(100).meta({ description: 'The completeness rule that reports it' }),
  fieldPath,
});

const input = z
  .object({
    kind: z.literal('answer-declarant-question'),
    mode: z.enum(['answer', 'hints']).meta({
      description:
        '`answer` streams an answer to the question (stream endpoint only); `hints` writes one hint per residual (job endpoint only)',
    }),
    language,
    question: z
      .string()
      .min(1)
      .max(2000)
      .nullable()
      .meta({ description: 'The declarant’s question; null in hints mode' }),
    context: z
      .object({
        declarationType: z.string().max(50).nullable(),
        statementDate: z.iso.date().nullable(),
        householdCounts: z.object({
          spouses: z.number().int().min(0),
          children: z.number().int().min(0),
        }),
        sectionKey: sectionKey.nullable().meta({ description: 'The section the declarant is on' }),
        residuals: z.array(residual).max(100).meta({
          description: 'What the completeness module still reports: where, and by which rule',
        }),
      })
      .meta({ description: 'Never contains amounts, names, identifiers or descriptions' }),
    passages: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          citation: z.string().max(200),
          text: z.string().max(10_000),
        }),
      )
      .max(20)
      .meta({ description: 'Retrieved corpus passages; an answer may cite only these' }),
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
      .max(10)
      .meta({ description: 'Earlier turns, oldest first, to resolve follow-up questions' }),
  })
  .refine((each) => (each.mode === 'answer') === (each.question !== null), {
    path: ['question'],
    message: 'A question is required in answer mode and must be null in hints mode',
  });

const output = z.object({
  declined: z.boolean().meta({
    description:
      'The passages do not answer the question; also set when a streamed answer fails its checks, which then has no blocks',
  }),
  blocks: z
    .array(
      z.object({
        text: z.string().max(1500),
        passageIds: z.array(z.string()).meta({
          description:
            'Passages the block rests on, all from the input; at least one in answer mode',
        }),
        sectionLink: z.object({ sectionKey, fieldPath: fieldPath.nullable() }).nullable().meta({
          description: 'Where in the declaration the block is about; in hints mode, its residual',
        }),
      }),
    )
    .max(20),
  followUps: z.array(z.string().max(200)).max(3),
});

export type AnswerInput = z.infer<typeof input>;
export type AnswerOutput = z.infer<typeof output>;

/**
 * Ask Adili (spec 11): an answer from the retrieved passages only, every block citing them, or a
 * decline; in hints mode, one plain-language hint per completeness residual.
 */
export const answerDeclarantQuestion = defineTask({
  name: 'answer-declarant-question',
  input,
  output,
  promptVersions: [1],
  maxOutputTokens: 2048,
  streamed: (each) => each.mode === 'answer',
  validate: (each, answer) =>
    each.mode === 'answer' ? answerViolations(each, answer) : hintViolations(each, answer),
  disclaimer: {
    en: 'AI-assisted. Not legal advice: check the cited law or ask your reporting officer.',
    sw: 'Imesaidiwa na AI. Si ushauri wa kisheria: soma sheria iliyotajwa au muulize afisa wako wa kupokea matamko.',
  },
});

/** Every block rests on passages from the input; a decline has no blocks (spec 11 S3). */
function answerViolations(each: AnswerInput, answer: AnswerOutput): OutputViolation[] {
  if (answer.declined) return [];
  if (answer.blocks.length === 0) return [{ kind: 'empty-answer' }];
  const known = new Set(each.passages.map((passage) => passage.id));
  return answer.blocks.flatMap((block, index): OutputViolation[] => {
    if (block.passageIds.length === 0) return [{ kind: 'uncited-block', block: index }];
    return block.passageIds.some((id) => !known.has(id))
      ? [{ kind: 'unknown-passage', block: index }]
      : [];
  });
}

/** One hint per residual, in order, linked to it; any citation from the input (spec 11 S5). */
function hintViolations(each: AnswerInput, answer: AnswerOutput): OutputViolation[] {
  const { residuals } = each.context;
  const known = new Set(each.passages.map((passage) => passage.id));
  const violations: OutputViolation[] = [];
  if (answer.declined) violations.push({ kind: 'declined-hints' });
  if (answer.followUps.length > 0) violations.push({ kind: 'hint-follow-ups' });
  if (answer.blocks.length !== residuals.length) {
    violations.push({
      kind: 'hint-count',
      expected: residuals.length,
      found: answer.blocks.length,
    });
  }
  answer.blocks.forEach((block, index) => {
    const target = residuals[index];
    const link = block.sectionLink;
    if (target && (link?.sectionKey !== target.sectionKey || link.fieldPath !== target.fieldPath)) {
      violations.push({ kind: 'hint-not-for-residual', block: index });
    }
    if (block.passageIds.some((id) => !known.has(id))) {
      violations.push({ kind: 'unknown-passage', block: index });
    }
  });
  return violations;
}
