import { appendFile } from 'node:fs/promises';

import type { ModelProvider, StructuredRequest } from '../../src/providers/port.js';
import { providerEnvSchema } from '../../src/providers/provider-env.js';
import { createModelProvider } from '../../src/providers/providers.module.js';
import { type PreparedPrompt, preparePrompt } from '../../src/policy/prompt.js';
import type { TaskDefinition } from '../../src/tasks/task.js';
import type { CaseResult, SoftResult } from './score.js';

/**
 * The prompt a job for this golden input sends: the input as the task parses it, minimised and
 * wrapped as untrusted with the gateway rules (`preparePrompt`, as the job executor builds it).
 * Fixtures are keyed by its request, so the runner and the prune script share it.
 */
export function evalPrompt(task: TaskDefinition, input: unknown, model: string): PreparedPrompt {
  return preparePrompt(task, task.currentPromptVersion, task.input.parse(input), model);
}

/** The provider request a job for this golden input makes. */
export function evalRequest(
  task: TaskDefinition,
  input: unknown,
  model: string,
): StructuredRequest {
  return evalPrompt(task, input, model).request;
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
 * The model the fixtures are recorded with. Fixtures are keyed by model, so evals pin it rather
 * than follow the service default; `AI_MODEL` overrides it to record and compare another model.
 */
export const EVAL_MODEL = 'claude-sonnet-5';

export function evalModel(): string {
  return process.env.AI_MODEL ?? EVAL_MODEL;
}

/** The provider and model the eval run uses, from the environment the eval config sets. */
export function evalProvider(): { provider: ModelProvider; model: string } {
  return {
    provider: createModelProvider(providerEnvSchema.parse(process.env)),
    model: evalModel(),
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
