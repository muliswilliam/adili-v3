import { afterAll, describe, expect, it } from 'vitest';

import type { OutputViolation, TaskDefinition } from '../../src/tasks/task.js';
import { evalProvider, publish, report, runCase } from './run.js';
import { type CaseResult, type Score, hardFailures, softResults } from './score.js';

export interface GoldenCase<TExpected> {
  /** Unique within the task; names the test. */
  name: string;
  /** The task input, synthetic only: fixtures commit it with the full prompt. */
  input: Record<string, unknown>;
  expected: TExpected;
}

/** A task's evaluation set: golden cases, how to score an output, soft thresholds. */
export interface EvalSuite<TExpected> {
  task: TaskDefinition;
  cases: readonly GoldenCase<TExpected>[];
  /**
   * A method, so suites with different expectations fit one list (SUITES). `violations` are what
   * the gateway's own checks find in the output (`TaskSpec.validate`, a streamed answer's grammar).
   */
  score(
    input: Record<string, unknown>,
    output: unknown,
    expected: TExpected,
    violations?: readonly OutputViolation[],
  ): Score[];
  /** Mean each soft scorer must reach over the cases. */
  thresholds: Readonly<Record<string, number>>;
  /**
   * The model the suite's fixtures were recorded on, when not `EVAL_MODEL`. Dropped once they are
   * recorded again on the default model.
   */
  model?: string;
}

/**
 * Registers the suite as tests: one per case, failing on any hard scorer below 1, then one for
 * the soft thresholds. Outputs come from the replay adapter (record mode refreshes them).
 */
export function evalSuite<TExpected>(suite: EvalSuite<TExpected>): void {
  const { provider, model } = evalProvider(suite);
  const results: CaseResult[] = [];

  describe(`${suite.task.name} v${suite.task.currentPromptVersion}`, () => {
    for (const golden of suite.cases) {
      it(golden.name, async () => {
        const { output, violations } = await runCase(suite.task, golden.input, provider, model);
        const scores = suite.score(golden.input, output, golden.expected, violations);
        results.push({ caseName: golden.name, scores });
        expect(hardFailures(scores)).toEqual([]);
      });
    }

    it('meets the soft thresholds', () => {
      expect(results, 'every case ran').toHaveLength(suite.cases.length);
      const soft = softResults(results, suite.thresholds);
      expect(soft.filter((each) => !each.passed)).toEqual([]);
    });

    afterAll(async () => {
      const soft = softResults(results, suite.thresholds);
      await publish(report(suite.task.name, suite.cases.length, results, soft));
    });
  });
}
