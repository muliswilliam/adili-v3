import { appendFile } from 'node:fs/promises';

import type {
  GenerateRequest,
  GenerateResult,
  ModelProvider,
  StructuredRequest,
} from '../../src/providers/port.js';
import { DEFAULT_AI_MODEL, providerEnvSchema } from '../../src/providers/provider-env.js';
import { createModelProvider } from '../../src/providers/providers.module.js';
import { UnknownTokenError } from '../../src/policy/minimisation.js';
import { type PreparedPrompt, preparePrompt, streamedRequest } from '../../src/policy/prompt.js';
import { DECLINED_ANSWER } from '../../src/tasks/answer-declarant-question.js';
import { TaggedAnswerReader } from '../../src/tasks/tagged-answer.js';
import type { OutputViolation, TaskDefinition } from '../../src/tasks/task.js';
import type { CaseResult, SoftResult } from './score.js';

/**
 * The prompt a job for this golden input sends: the input as the task parses it, minimised and
 * wrapped as untrusted with the gateway rules (`preparePrompt`, as the job executor builds it).
 * Fixtures are keyed by its request, so the runner and the prune script share it.
 */
export function evalPrompt(task: TaskDefinition, input: unknown, model: string): PreparedPrompt {
  return preparePrompt(task, task.currentPromptVersion, task.input.parse(input), model);
}

/**
 * The provider request a job for this golden input makes: a streamed task's input (ADR-019) asks
 * for tagged text, without the output schema.
 */
export function evalRequest(
  task: TaskDefinition,
  input: unknown,
  model: string,
): StructuredRequest | GenerateRequest {
  const { request } = evalPrompt(task, input, model);
  return streamed(task, input) ? streamedRequest(request) : request;
}

/** Whether the gateway answers this input over the stream endpoint rather than as a job. */
export function streamed(task: TaskDefinition, input: unknown): boolean {
  return task.streamed?.(task.input.parse(input)) ?? false;
}

/** What a case produced: its output, and what the gateway's checks would find in it. */
export interface CaseOutput {
  output: unknown;
  /** The task's own checks, or why a streamed answer could not be read (a decline then). */
  violations: OutputViolation[];
}

/** Runs a case as the gateway would: streamed when the task streams the input, else as a job. */
export async function runCase(
  task: TaskDefinition,
  input: unknown,
  provider: ModelProvider,
  model: string,
): Promise<CaseOutput> {
  if (streamed(task, input)) return runStreamed(task, input, provider, model);
  const output = await runTask(task, input, provider, model);
  return { output, violations: checks(task, input, output) };
}

/**
 * Runs a streamed golden input as the stream endpoint does: the deltas read as tagged text, the
 * answer restored and checked against the schema. The output is the answer as written, before the
 * gateway's checks replace a failing one with a decline, so the hard scorers judge the model; an
 * answer that cannot be read is a decline, with the reasons as violations.
 */
export async function runStreamed(
  task: TaskDefinition,
  input: unknown,
  provider: ModelProvider,
  model: string,
): Promise<CaseOutput> {
  const prompt = evalPrompt(task, input, model);
  const reader = new TaggedAnswerReader();
  let result: GenerateResult | undefined;
  for await (const event of provider.stream(streamedRequest(prompt.request))) {
    if (event.type === 'delta') reader.push(event.text);
    else result = event.result;
  }
  if (result?.status !== 'completed' && result?.status !== 'truncated') {
    throw new Error(`${task.name}: the provider returned ${result?.status ?? 'no result'}`);
  }
  // Cut off, or not read: the gateway stores a decline, with the reasons as violations.
  const { answer } = reader.end(result.status);
  if (!answer.ok) return { output: DECLINED_ANSWER, violations: answer.problems };
  let restored: unknown;
  try {
    restored = prompt.restore(task.output.parse(answer.answer));
  } catch (error) {
    // A token the input never had: the gateway declines it, as any failed check (ADR-019).
    if (!(error instanceof UnknownTokenError)) throw error;
    return { output: DECLINED_ANSWER, violations: [{ kind: 'unknown-token' }] };
  }
  const output = task.output.parse(restored);
  return { output, violations: checks(task, input, output) };
}

function checks(task: TaskDefinition, input: unknown, output: unknown): OutputViolation[] {
  return task.validate?.(task.input.parse(input), task.output.parse(output)) ?? [];
}

/**
 * Runs one golden input through the task layer as a job would: the request the gateway sends,
 * the provider (replay in CI), the task's output schema, then the identifiers restored and the
 * schema checked again. The output is what a job would store, minus its label. The gate, budget
 * and audit are the job path's concern and tested there; the refs check is a hard scorer.
 */
export async function runTask(
  task: TaskDefinition,
  input: unknown,
  provider: ModelProvider,
  model: string,
): Promise<unknown> {
  const prompt = evalPrompt(task, input, model);
  const result = await provider.generateStructured(prompt.request);
  if (result.status !== 'completed') {
    throw new Error(`${task.name}: the provider returned ${result.status}, not an output`);
  }
  return task.output.parse(prompt.restore(task.output.parse(result.output)));
}

/**
 * The model the fixtures are recorded with: the service default, which production runs.
 * Fixtures are keyed by model, so changing the default misses them until they are recorded
 * again; `AI_MODEL` overrides it to record and compare another model.
 */
export const EVAL_MODEL = DEFAULT_AI_MODEL;

/** The model a suite runs on: `AI_MODEL`, else the model its fixtures were recorded on. */
export function evalModel(suite: { model?: string } = {}): string {
  return process.env.AI_MODEL ?? suite.model ?? EVAL_MODEL;
}

/** The provider and model a suite's run uses, from the environment the eval config sets. */
export function evalProvider(suite: { model?: string } = {}): {
  provider: ModelProvider;
  model: string;
} {
  return {
    provider: createModelProvider(providerEnvSchema.parse(process.env)),
    model: evalModel(suite),
  };
}

/** A markdown table of a task's results, for the CI job summary and the terminal. */
export function report(
  task: string,
  cases: number,
  results: readonly CaseResult[],
  soft: SoftResult[],
): string {
  const hard = new Map<string, number>();
  for (const { scores } of results) {
    for (const score of scores.filter((each) => each.hard)) {
      hard.set(score.scorer, (hard.get(score.scorer) ?? 0) + (score.score === 1 ? 0 : 1));
    }
  }
  const rows = [
    ...[...hard].map(
      ([scorer, failed]) =>
        `| ${scorer} | hard | ${results.length - failed}/${results.length} cases | all | ${failed === 0 ? 'pass' : 'FAIL'} |`,
    ),
    ...soft.map(
      ({ scorer, mean, threshold, passed }) =>
        `| ${scorer} | soft | ${mean.toFixed(2)} | ${threshold.toFixed(2)} | ${passed ? 'pass' : 'FAIL'} |`,
    ),
  ];
  return [
    `### Evals: ${task} (${results.length} of ${cases} cases scored)`,
    '',
    '| Scorer | Kind | Result | Threshold | |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

/** Appends to the GitHub Actions job summary when there is one. */
export async function publish(markdown: string): Promise<void> {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, `${markdown}\n`);
}
