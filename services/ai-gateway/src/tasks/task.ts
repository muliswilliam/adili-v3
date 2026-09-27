import { readFileSync } from 'node:fs';

import { z } from 'zod';

import type { JsonSchema } from '../providers/port.js';
import type { Language } from './common.js';

/** Contract `TaskName`s the gateway serves. */
export const TASK_NAMES = [
  'summarize-declaration',
  'explain-flags',
  'draft-clarification',
] as const;
export type TaskName = (typeof TASK_NAMES)[number];

interface TaskSpec<TInput extends z.ZodObject, TOutput extends z.ZodObject> {
  name: TaskName;
  /** The task's contract input; `kind` equals the task name. */
  input: TInput;
  /** What the model must return. The gateway adds the `label` to form the job output. */
  output: TOutput;
  /** Prompt versions with a file `prompts/<task>/v<N>.md`; the last one is current. */
  promptVersions: readonly [number, ...number[]];
  /** Default output limit; the routing table may override it. */
  maxOutputTokens: number;
}

export interface TaskDefinition<
  TInput extends z.ZodObject = z.ZodObject,
  TOutput extends z.ZodObject = z.ZodObject,
> extends TaskSpec<TInput, TOutput> {
  currentPromptVersion: number;
  /** `output` as JSON Schema, sent to the provider for structured output. */
  outputJsonSchema: JsonSchema;
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
    prompt(version) {
      const prompt = prompts.get(version);
      if (prompt === undefined) {
        throw new Error(`Task ${spec.name} has no prompt version ${version}`);
      }
      return prompt;
    },
  };
}

/** Contract `AiLabel`: present on every job output. */
export interface AiLabel {
  aiAssisted: true;
  task: TaskName;
  promptVersion: number;
  provider: string;
  model: string;
  generatedAt: string;
  disclaimer: string;
}

const DISCLAIMERS: Record<Language, string> = {
  en: 'AI-assisted. These are indicators, not findings: a named officer reviews the record and decides.',
  sw: 'Imesaidiwa na AI. Hivi ni viashiria, si matokeo: afisa aliyetajwa hukagua rekodi na kuamua.',
};

export function aiLabel(
  fields: Omit<AiLabel, 'aiAssisted' | 'disclaimer'>,
  language: Language,
): AiLabel {
  return { aiAssisted: true, ...fields, disclaimer: DISCLAIMERS[language] };
}
