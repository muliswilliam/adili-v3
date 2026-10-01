import { describe, expect, it } from 'vitest';

import { TASK_NAMES } from '../../src/tasks/task.js';
import { refProblem } from '../lib/refs.js';
import type { FlagInput } from './flags.js';
import { SUITES } from './suites.js';

/** The golden sets themselves: valid task inputs, in both languages, internally consistent. */
describe('golden sets', () => {
  it('cover every task', () => {
    expect(SUITES.map((suite) => suite.task.name).sort()).toEqual([...TASK_NAMES].sort());
  });

  for (const suite of SUITES) {
    describe(suite.task.name, () => {
      it('has 12 uniquely named cases, 4 in Swahili', () => {
        const names = suite.cases.map((each) => each.name);
        expect(new Set(names).size).toBe(12);
        expect(suite.cases.filter((each) => each.input.language === 'sw')).toHaveLength(4);
      });

      for (const golden of suite.cases) {
        it(`${golden.name}: is a valid task input`, () => {
          expect(suite.task.input.safeParse(golden.input).error?.issues ?? []).toEqual([]);
        });
      }
    });
  }

  it('summaries cite only items and people of their documents', () => {
    const summarize = SUITES.find((suite) => suite.task.name === 'summarize-declaration');
    for (const golden of summarize?.cases ?? []) {
      const documents = [golden.input.document, golden.input.previousDocument];
      const refs = [
        ...(golden.input.flags as FlagInput[]).flatMap((each) => each.itemRefs),
        ...(golden.input.changes as { personKey: string; itemId: string | null }[]).map((each) => ({
          ...each,
          sectionKey: null,
          fieldPath: null,
        })),
      ];
      expect(
        refs.map((ref) => refProblem(ref, documents)).filter((problem) => problem !== null),
        golden.name,
      ).toEqual([]);
    }
  });
});
