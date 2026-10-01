import { appendFile } from 'node:fs/promises';

import type { ModelProvider, StructuredRequest } from '../../src/providers/port.js';
import { providerEnvSchema } from '../../src/providers/provider-env.js';
import { createModelProvider } from '../../src/providers/providers.module.js';
import { buildProviderRequest } from '../../src/tasks/provider-request.js';
import type { TaskDefinition } from '../../src/tasks/task.js';
import type { CaseResult, SoftResult } from './score.js';

/**
 * The provider request a job for this golden input makes: the task's current prompt, the input
 * as the task parses it. Fixtures are keyed by it, so the runner and the prune script share it.
 */
export function evalRequest(
  task: TaskDefinition,
  input: unknown,
  model: string,
): StructuredRequest {
  return buildProviderRequest(task, task.currentPromptVersion, task.input.parse(input), model);
}

/**
 * Runs one golden input through the task layer as a job would: the provider request the gateway
 * builds, the provider (replay in CI), the task's output schema. Gateway policy (gate,
 * minimisation, audit) is the job path's concern and tested there.
 */
export async function runTask(
  task: TaskDefinition,
  input: unknown,
  provider: ModelProvider,
  model: string,
): Promise<unknown> {
  const result = await provider.generateStructured(evalRequest(task, input, model));
  if (result.status !== 'completed') {
    throw new Error(`${task.name}: the provider returned ${result.status}, not an output`);
  }
  return task.output.parse(result.output);
}

/** The provider and model the eval run uses, from the environment the eval config sets. */
export function evalProvider(): { provider: ModelProvider; model: string } {
  const env = providerEnvSchema.parse(process.env);
  return { provider: createModelProvider(env), model: env.AI_MODEL };
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
