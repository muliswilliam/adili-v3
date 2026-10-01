import { afterAll, describe, expect, it } from 'vitest';

import type { TaskDefinition } from '../../src/tasks/task.js';
import { evalProvider, publish, report, runTask } from './run.js';
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
  /** A method, so suites with different expectations fit one list (SUITES). */
  score(input: Record<string, unknown>, output: unknown, expected: TExpected): Score[];
  /** Mean each soft scorer must reach over the cases. */
  thresholds: Readonly<Record<string, number>>;
}

/**
 * Registers the suite as tests: one per case, failing on any hard scorer below 1, then one for
 * the soft thresholds. Outputs come from the replay adapter (record mode refreshes them).
 */
export function evalSuite<TExpected>(suite: EvalSuite<TExpected>): void {
  const { provider, model } = evalProvider();
  const results: CaseResult[] = [];

  describe(`${suite.task.name} v${suite.task.currentPromptVersion}`, () => {
    for (const golden of suite.cases) {
      it(golden.name, async () => {
        const output = await runTask(suite.task, golden.input, provider, model);
        const scores = suite.score(golden.input, output, golden.expected);
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
