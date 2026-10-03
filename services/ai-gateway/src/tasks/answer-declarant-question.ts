import { z } from 'zod';

import { language } from './common.js';
import { defineTask, type OutputViolation } from './task.js';

/** A declaration section: `bio`, `household`, `other` or one person's `statement:<personKey>`. */
const sectionKey = z
  .string()
  .regex(/^(bio|household|other|statement:(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36}))$/)
  .meta({ description: 'bio, household, other, or statement:<personKey> (declarations.yaml)' });

const fieldPath = z.string().max(200).meta({ description: 'JSON pointer within the section' });

/**
 * Why and where the declarations service's completeness check reports a residual: the code of a
 * `CompletenessIssue` (declarations.yaml), which is one of its own rules' kebab-case codes or, for a
 * `declaration.v1` schema issue, the ajv keyword that failed (camelCase: `minLength`,
 * `exclusiveMinimum`); and its path, a pointer of `declaration.v1` field names (camelCase) and
 * array indexes. Neither can carry a value, such as a registration or a name, which the context
 * never holds.
 */
const ruleId = z
  .string()
  .max(100)
  .regex(/^[a-z][A-Za-z0-9]*(-[a-z0-9]+)*$/)
  .meta({
    description:
      'The completeness rule or schema keyword that reports it, e.g. nil-or-items-required, minLength',
  });
const residualPath = fieldPath.regex(/^(\/([a-z][A-Za-z0-9]*|0|[1-9][0-9]*))*$/).meta({
  description: 'JSON pointer within the section, field names and indexes: /assets/1/value',
});

const residual = z.object({ sectionKey, ruleId, fieldPath: residualPath });

/** Blocks an answer may have; a hint set has one per residual, so residuals are capped alike. */
const MAX_BLOCKS = 20;

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
      .meta({ description: "The declarant's question; null in hints mode" }),
    context: z
      .object({
        declarationType: z
          .enum(['initial', 'biennial', 'final'])
          .nullable()
          .meta({ description: 'The type of the declaration being filled (declarations.yaml)' }),
        statementDate: z.iso.date().nullable(),
        householdCounts: z.object({
          spouses: z.number().int().min(0),
          children: z.number().int().min(0),
        }),
        sectionKey: sectionKey.nullable().meta({ description: 'The section the declarant is on' }),
        residuals: z.array(residual).max(MAX_BLOCKS).meta({
          description: 'What the completeness check still reports: where, and by which rule',
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
    .max(MAX_BLOCKS),
  followUps: z.array(z.string().max(200)).max(3),
});

export type AnswerInput = z.infer<typeof input>;
export type AnswerOutput = z.infer<typeof output>;

/**
 * What a streamed answer that failed its checks is stored as (ADR-019): a decline, with no blocks,
 * so the caller shows its decline text.
 */
export const DECLINED_ANSWER: AnswerOutput = { declined: true, blocks: [], followUps: [] };

/**
 * Ask Adili (spec 11): an answer from the retrieved passages only, every block citing them, or a
 * decline; in hints mode, one plain-language hint per completeness residual.
 */
export const answerDeclarantQuestion = defineTask({
  name: 'answer-declarant-question',
  input,
  output,
  promptVersions: [1],
  // An answer is a few paragraphs: one that runs away is cut off and declined (ADR-019) well before
  // the stream's deadline, rather than timing out. Twenty hints, the most a call writes: the golden
  // hint sets take about 230 output tokens a hint in Swahili, 170 in English, plus up to 560 for the
  // call (thinking included), so about 5,000.
  maxOutputTokens: (each) => (each.mode === 'answer' ? 2048 : 8192),
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
