import { readFileSync } from 'node:fs';

import { z } from 'zod';

import type { JsonSchema } from '../providers/port.js';
import type { Language } from './common.js';

/** Contract `TaskName`s the gateway serves. */
export const TASK_NAMES = [
  'summarize-declaration',
  'explain-flags',
  'draft-clarification',
  'narrate-compliance-report',
  'answer-declarant-question',
] as const;
export type TaskName = (typeof TASK_NAMES)[number];
export const taskNameSchema = z.enum(TASK_NAMES);

/**
 * The tasks a Commission's officers call; the rest serve EACC alone (`narrate-compliance-report`
 * drafts the national report). A Commission's AI status reads only these routes.
 */
export const COMMISSION_TASKS = [
  'summarize-declaration',
  'explain-flags',
  'draft-clarification',
] as const satisfies readonly TaskName[];

/** Contract `AiLabel`: present on every job output. */
export const aiLabelSchema = z
  .object({
    aiAssisted: z.literal(true),
    task: taskNameSchema,
    promptVersion: z.number().int(),
    provider: z.string(),
    model: z.string(),
    generatedAt: z.iso.datetime(),
    disclaimer: z.string().meta({
      description:
        "Fixed text per task and language: for the reviewer tasks, indicators, not findings, a named reviewer decides; for a declarant's answers, not legal advice",
    }),
  })
  .meta({ description: 'Present on every output' });
export type AiLabel = z.infer<typeof aiLabelSchema>;

/**
 * Why an output that fits the schema still fails its task: a kind, and where (paragraph and item
 * indexes, section names). Never output text or figures, not even a ref or id the model made up,
 * as these are stored with the job and its audit record (the first twenty of them).
 */
export interface OutputViolation {
  kind: string;
  [detail: string]: string | number;
}

interface TaskSpec<TInput extends z.ZodObject, TOutput extends z.ZodObject> {
  name: TaskName;
  /** The task's contract input; `kind` equals the task name. */
  input: TInput;
  /** What the model must return. The gateway adds the `label` to form the job output. */
  output: TOutput;
  /** Prompt versions with a file `prompts/<task>/v<N>.md`; the last one is current. */
  promptVersions: readonly [number, ...number[]];
  /** Output limit of every call for this task. */
  maxOutputTokens: number;
  /**
   * The task's own checks of an output against its input, beyond the schema and source refs. Any
   * violation fails the job with reason `validation`.
   */
  validate?: (input: z.infer<TInput>, output: z.infer<TOutput>) => OutputViolation[];
  /**
   * The inputs this task answers over the stream endpoint, as text deltas then the output, rather
   * than as a job; the job endpoint refuses them, and the stream endpoint refuses the rest.
   */
  streamed?: (input: z.infer<TInput>) => boolean;
  /** The label's disclaimer per language, when not the reviewer tasks' (`DISCLAIMERS`). */
  disclaimer?: Readonly<Record<Language, string>>;
  /**
   * Hours a finished job keeps this task's output, when shorter than the service-wide
   * `AI_OUTPUT_RETENTION_DAYS` (a clarification draft is kept 24 hours, spec 07c).
   */
  outputRetentionHours?: number;
}

export interface TaskDefinition<
  TInput extends z.ZodObject = z.ZodObject,
  TOutput extends z.ZodObject = z.ZodObject,
> extends TaskSpec<TInput, TOutput> {
  currentPromptVersion: number;
  /** `output` as JSON Schema, sent to the provider for structured output. */
  outputJsonSchema: JsonSchema;
  /** The job's output (contract `<Task>Output`): `output` with the gateway's `label` first. */
  jobOutput: z.ZodObject;
  /** The system prompt of a version; throws for a version the task does not have. */
  prompt(version: number): string;
}

const PROMPTS_DIR = new URL('../../prompts/', import.meta.url);

/**
 * Declares a task: typed input, output schema and versioned prompts. Prompt files are read
 * here, at startup, so a missing prompt fails the service rather than a job.
 */
export function defineTask<TInput extends z.ZodObject, TOutput extends z.ZodObject>(
  spec: TaskSpec<TInput, TOutput>,
): TaskDefinition<TInput, TOutput> {
  const prompts = new Map(
    spec.promptVersions.map((version) => [
      version,
      readFileSync(new URL(`${spec.name}/v${version}.md`, PROMPTS_DIR), 'utf8'),
    ]),
  );
  const outputJsonSchema: JsonSchema = z.toJSONSchema(spec.output, { target: 'draft-2020-12' });
  // The dialect marker means nothing to providers; the schema is sent without it.
  delete outputJsonSchema.$schema;
  return {
    ...spec,
    currentPromptVersion: Math.max(...spec.promptVersions),
    outputJsonSchema,
    jobOutput: z.object({ label: aiLabelSchema, ...spec.output.shape }),
    prompt(version) {
      const prompt = prompts.get(version);
      if (prompt === undefined) {
        throw new Error(`Task ${spec.name} has no prompt version ${version}`);
      }
      return prompt;
    },
  };
}

const DISCLAIMERS: Record<Language, string> = {
  en: 'AI-assisted. These are indicators, not findings: a named reviewer examines the record and decides.',
  sw: 'Imesaidiwa na AI. Hivi ni viashiria, si matokeo: mkaguzi aliyetajwa huchunguza rekodi na kuamua.',
};

export function aiLabel(
  fields: Omit<AiLabel, 'aiAssisted' | 'disclaimer'>,
  language: Language,
  disclaimers: Readonly<Record<Language, string>> = DISCLAIMERS,
): AiLabel {
  return { aiAssisted: true, ...fields, disclaimer: disclaimers[language] };
}
