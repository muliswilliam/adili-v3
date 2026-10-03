import { readFileSync } from 'node:fs';

import { z } from 'zod';

import type { DocumentContentType, ReadDocument } from '../documents/read-document.js';
import type { DataClass } from '../jobs/task-request.js';
import type { JsonSchema } from '../providers/port.js';
import type { Language } from './common.js';

/** Contract `TaskName`s the gateway serves. */
export const TASK_NAMES = [
  'summarize-declaration',
  'explain-flags',
  'draft-clarification',
  'narrate-compliance-report',
  'answer-declarant-question',
  'extract-document',
] as const;
export type TaskName = (typeof TASK_NAMES)[number];
export const taskNameSchema = z.enum(TASK_NAMES);

/**
 * Tasks only EACC calls: `narrate-compliance-report` drafts the national report (NCR), not a
 * Commission's Form M (ADR-007).
 */
export const EACC_TASKS = ['narrate-compliance-report'] as const satisfies readonly TaskName[];

/**
 * The tasks a Commission's tenant calls, and may route: every task but EACC's, so a new task counts
 * unless it is listed there.
 */
export const COMMISSION_TASKS = TASK_NAMES.filter(
  (task): task is Exclude<TaskName, (typeof EACC_TASKS)[number]> =>
    !(EACC_TASKS as readonly TaskName[]).includes(task),
);

/**
 * Tasks a declarant's own questions call (Ask Adili, spec 11): public law and field paths only, so
 * they work whatever the Commission's AI policy and are not its officers' AI assistance.
 */
export const DECLARANT_TASKS = ['answer-declarant-question'] as const satisfies readonly TaskName[];

/**
 * Tasks that read a declarant's document into the form (spec 05b): on the declarant's request,
 * under the Commission's gate, but not its officers' review assistance.
 */
export const DOCUMENT_TASKS = ['extract-document'] as const satisfies readonly TaskName[];

/**
 * The Commission tasks its officers call to review declarations. A Commission's AI status reads
 * only these routes.
 */
export const REVIEWER_TASKS = COMMISSION_TASKS.filter(
  (task) =>
    !(DECLARANT_TASKS as readonly TaskName[]).includes(task) &&
    !(DOCUMENT_TASKS as readonly TaskName[]).includes(task),
);

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
  kind: ViolationKind;
  [detail: string]: string | number;
}

/** Every kind of violation, by what finds it: stored with jobs and audit records, so closed. */
export const VIOLATION_KINDS = [
  // narrate-compliance-report's checks (narrative-validation.ts)
  'foreign-number',
  'unknown-ref',
  'unknown-candidate',
  'finding-without-candidate',
  'wrong-section',
  'missing-section',
  'too-many-paragraphs',
  // answer-declarant-question's checks
  'empty-answer',
  'uncited-block',
  'unknown-passage',
  'unknown-link',
  'declined-hints',
  'hint-follow-ups',
  'hint-count',
  'hint-not-for-residual',
  // The tagged-text grammar of a streamed answer (ADR-019, tagged-answer.ts)
  'text-outside-block',
  'unknown-tag',
  'nested-block',
  'misplaced-tag',
  'empty-block',
  'cite-repeated',
  'link-repeated',
  'link-invalid',
  'unclosed-block',
  'unclosed-followup',
  'declined-with-answer',
  // How a streamed answer ended: cut off, a token the input never had, or off its schema
  'truncated',
  'unknown-token',
  'invalid-output',
  // extract-document's checks
  'duplicate-field',
  'account-number',
] as const;
export type ViolationKind = (typeof VIOLATION_KINDS)[number];

/** A document a task reads: where to fetch it, and what it must be. */
export interface DocumentRef {
  downloadUrl: string;
  contentType: DocumentContentType;
  sha256: string;
}

interface TaskSpec<TInput extends z.ZodObject, TOutput extends z.ZodObject> {
  name: TaskName;
  /** The task's contract input; `kind` equals the task name. */
  input: TInput;
  /** What the model must return. The gateway adds the `label` to form the job output. */
  output: TOutput;
  /**
   * What the model must return for this input, when narrower than `output` (extract-document's
   * fields are the target item type's): sent as the output schema and checked like `output`.
   */
  outputFor?: (input: z.infer<TInput>) => TOutput;
  /**
   * What identifies the input for the cache and the Idempotency-Key, when not all of it:
   * extract-document's download link changes with every request, its document's SHA-256 does not.
   */
  identity?: (input: z.infer<TInput>) => unknown;
  /**
   * The document the input names, which the gateway fetches and reads before the call (spec 05b).
   */
  document?: (input: z.infer<TInput>) => DocumentRef;
  /**
   * The input as the model sees it, when not all of it: extract-document's without the download
   * link, with the document's text layer. Minimised like any input.
   */
  modelInput?: (input: z.infer<TInput>, document: ReadDocument | undefined) => unknown;
  /** Prompt versions with a file `prompts/<task>/v<N>.md`; the last one is current. */
  promptVersions: readonly [number, ...number[]];
  /** Output limit of every call for this task, or of a call for this input. */
  maxOutputTokens: number | ((input: z.infer<TInput>) => number);
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
  /**
   * The one data class this task's input may be, when its schema decides it: a request naming
   * another is refused as invalid, before any job.
   */
  dataClass?: DataClass;
  /** The label's disclaimer per language, when not the reviewer tasks' (`DISCLAIMERS`). */
  disclaimer?: Readonly<Record<Language, string>>;
  /**
   * Hours a finished job keeps this task's output, when shorter than the service-wide
   * `AI_OUTPUT_RETENTION_HOURS` (a clarification draft is kept 24 hours, spec 07c).
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
  const outputJsonSchema = toJsonSchema(spec.output);
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

/** JSON Schemas of the narrower output schemas (`outputFor`), which tasks build once each. */
const outputSchemas = new WeakMap<z.ZodObject, JsonSchema>();

/** The output schema of a call for `input`, the job's input as the task validated it. */
export function outputSchemaOf(task: TaskDefinition, input: unknown): z.ZodObject {
  return task.outputFor ? task.outputFor(input as z.infer<z.ZodObject>) : task.output;
}

/** `outputSchemaOf` as JSON Schema, for the provider; computed once per schema. */
export function outputJsonSchemaOf(task: TaskDefinition, input: unknown): JsonSchema {
  const schema = outputSchemaOf(task, input);
  if (schema === task.output) return task.outputJsonSchema;
  let json = outputSchemas.get(schema);
  if (!json) {
    json = toJsonSchema(schema);
    outputSchemas.set(schema, json);
  }
  return json;
}

/** What identifies `input` for the cache and the Idempotency-Key. */
export function inputIdentity(task: TaskDefinition, input: unknown): unknown {
  return task.identity ? task.identity(input as z.infer<z.ZodObject>) : input;
}

function toJsonSchema(schema: z.ZodObject): JsonSchema {
  const json: JsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  // The dialect marker means nothing to providers; the schema is sent without it.
  delete json.$schema;
  return json;
}

/**
 * The output limit of a call for `input`, the job's input as the task validated it (minimised or
 * not: the limit never depends on an identifier).
 */
export function outputLimit(task: TaskDefinition, input: unknown): number {
  const limit = task.maxOutputTokens;
  return typeof limit === 'number' ? limit : limit(input as z.infer<z.ZodObject>);
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
