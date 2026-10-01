import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ReplayAdapter } from '../src/providers/replay.adapter.js';
import { ScriptedProvider } from '../test/support/scripted-provider.js';
import { IDS, PEOPLE } from './golden/declarations.js';
import { itemRef } from './golden/flags.js';
import { SUITES } from './golden/suites.js';
import { runTask } from './lib/run.js';
import type { Score } from './lib/score.js';

/**
 * The test of the test (spec 07c S9): a fixture whose recorded output invents a number, points at
 * an item the input does not have and states a finding fails the hard scorers, while a sound
 * output for the same case passes them. Both go through record and replay as CI's fixtures do.
 */

const MODEL = 'eval-test-model';
const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const UNKNOWN_ITEM = '0199e0a0-dead-7000-8000-000000000000';

let fixturesDir: string;

beforeAll(async () => {
  fixturesDir = await mkdtemp(join(tmpdir(), 'ai-gateway-evals-'));
});

afterAll(async () => {
  await rm(fixturesDir, { recursive: true, force: true });
});

/** Records `output` as the provider's answer for a golden case, replays it and scores it. */
async function scoreRecorded(task: string, caseName: string, output: unknown): Promise<Score[]> {
  const suite = SUITES.find((each) => each.task.name === task);
  const golden = suite?.cases.find((each) => each.name === caseName);
  if (!suite || !golden) throw new Error(`No golden case ${task} / ${caseName}`);
  const dir = await mkdtemp(join(fixturesDir, 'case-'));
  const recorder = new ReplayAdapter({
    fixturesDir: dir,
    mode: 'record',
    inner: new ScriptedProvider(() =>
      Promise.resolve({ status: 'completed', output, model: MODEL, usage }),
    ),
  });
  await runTask(suite.task, golden.input, recorder, MODEL);
  const replayed = await runTask(
    suite.task,
    golden.input,
    new ReplayAdapter({ fixturesDir: dir, mode: 'replay' }),
    MODEL,
  );
  return suite.score(golden.input, replayed, golden.expected);
}

const failingHard = (scores: Score[]) =>
  scores.filter((score) => score.hard && score.score < 1).map((score) => score.scorer);

const savings = itemRef(PEOPLE.officer, IDS.savings);
const unknown = { ...savings, itemId: UNKNOWN_ITEM };

const summary = {
  overview:
    'A biennial declaration covering the officer, two spouses and two children, with salary, rent and business income, land, a savings account abroad, a vehicle and a loan.',
  changesSincePrevious: [
    {
      text: 'Rent from two flats in Kisumu is a new source of income.',
      refs: [itemRef(PEOPLE.officer, IDS.rent)],
    },
    {
      text: 'The Toyota Prado was acquired, valued at KES 6,500,000.',
      refs: [itemRef(PEOPLE.officer, IDS.prado)],
    },
    { text: 'The savings account rose by 43% to KES 1,290,000.', refs: [savings] },
    {
      text: 'The pharmacy loan fell by 40% to KES 750,000.',
      refs: [itemRef(PEOPLE.grace, IDS.pharmacyLoan)],
    },
    { text: 'A teacher salary is newly declared.', refs: [itemRef(PEOPLE.mary, IDS.marySalary)] },
  ],
  sections: [
    {
      sectionKey: `statement:${PEOPLE.officer}`,
      text: 'Salary, rent, the Kisumu plot, the savings account and the Prado.',
      refs: [itemRef(PEOPLE.officer, IDS.salary)],
    },
  ],
  worthAttention: [
    {
      text: 'Check the explanation for the savings increase.',
      flagIds: ['0199e0a0-f1a6-7000-8000-000000000001'],
    },
  ],
};

const explanation = {
  explanations: [
    {
      flagId: '0199e0a0-f1a6-7000-8000-000000000021',
      meaning:
        'The savings account value rose by 43% since the previous declaration. This is an indicator to check, not a finding of wrongdoing.',
      whatToCheck: ['Reread the explanation given for the savings account.'],
      typicalResolution: 'A bank statement showing the interest and the transfer.',
      refs: [savings],
    },
  ],
};

const draft = {
  opening: null,
  items: [
    {
      ref: savings,
      requirement: 'explain-discrepancy',
      text: 'Please explain the increase in the value of the savings account held while on study leave since your previous declaration.',
    },
  ],
};

describe('hard scorers on recorded fixtures', () => {
  it('pass sound outputs', async () => {
    expect(
      failingHard(await scoreRecorded('summarize-declaration', 'household amendment', summary)),
    ).toEqual([]);
    expect(
      failingHard(await scoreRecorded('explain-flags', 'savings up 43%', explanation)),
    ).toEqual([]);
    expect(
      failingHard(await scoreRecorded('draft-clarification', 'savings rise to explain', draft)),
    ).toEqual([]);
  });

  it('fail a summary that invents a number, an item and a finding', async () => {
    const broken = structuredClone(summary);
    broken.overview += ' The declarant is non-compliant.';
    broken.changesSincePrevious[2] = {
      text: 'The savings account rose by KES 400,000.',
      refs: [unknown],
    };
    expect(
      failingHard(await scoreRecorded('summarize-declaration', 'household amendment', broken)),
    ).toEqual(['refs-resolve', 'no-foreign-numbers', 'no-verdict']);
  });

  it('fail explanations that skip the flag, point elsewhere and accuse', async () => {
    const broken = {
      explanations: explanation.explanations.map((each) => ({
        ...each,
        flagId: '0199e0a0-f1a6-7000-8000-000000000099',
        meaning: 'This shows corruption: the balance rose by KES 390,000.',
        refs: [unknown],
      })),
    };
    expect(failingHard(await scoreRecorded('explain-flags', 'savings up 43%', broken))).toEqual([
      'refs-resolve',
      'one-per-flag',
      'no-foreign-numbers',
      'no-verdict',
    ]);
  });

  it('fail a draft that overrides the reviewer, moves the item and accuses', async () => {
    const broken = structuredClone(draft);
    broken.items[0] = {
      ref: unknown,
      requirement: 'correct',
      text: 'You failed to comply with the Act. Explain the KES 390,000 rise.',
    };
    expect(
      failingHard(await scoreRecorded('draft-clarification', 'savings rise to explain', broken)),
    ).toEqual(['refs-resolve', 'follows-selections', 'no-foreign-numbers', 'no-verdict']);
  });
});
