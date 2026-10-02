import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ReplayAdapter, ReplayFixtureMissingError } from '../src/providers/replay.adapter.js';
import { ScriptedProvider, ScriptedStreamProvider } from '../test/support/scripted-provider.js';
import { IDS, PEOPLE } from './golden/declarations.js';
import { itemRef } from './golden/flags.js';
import { SUITES } from './golden/suites.js';
import { runCase, runTask } from './lib/run.js';
import { type Score, hardFailures } from './lib/score.js';

/**
 * The test of the test (spec 07c S9): a fixture whose recorded output invents a number, points at
 * an item the input does not have and uses verdict language fails the check `evalSuite` fails a
 * case on, while a sound output for the same case passes it. Both go through record and replay as
 * CI's fixtures do. A changed prompt, schema or model misses the recorded fixture altogether.
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

function goldenCase(task: string, caseName: string) {
  const suite = SUITES.find((each) => each.task.name === task);
  const golden = suite?.cases.find((each) => each.name === caseName);
  if (!suite || !golden) throw new Error(`No golden case ${task} / ${caseName}`);
  return { suite, golden };
}

/** Records `output` as the provider's answer for a golden case into a fresh fixtures directory. */
async function record(task: string, caseName: string, output: unknown): Promise<string> {
  const { suite, golden } = goldenCase(task, caseName);
  const dir = await mkdtemp(join(fixturesDir, 'case-'));
  const recorder = new ReplayAdapter({
    fixturesDir: dir,
    mode: 'record',
    inner: new ScriptedProvider(() =>
      Promise.resolve({ status: 'completed', output, model: MODEL, usage }),
    ),
  });
  await runTask(suite.task, golden.input, recorder, MODEL);
  return dir;
}

/** Records `output` for a golden case, replays it and scores it. */
async function scoreRecorded(task: string, caseName: string, output: unknown): Promise<Score[]> {
  const { suite, golden } = goldenCase(task, caseName);
  const dir = await record(task, caseName, output);
  const replayed = await runTask(
    suite.task,
    golden.input,
    new ReplayAdapter({ fixturesDir: dir, mode: 'replay' }),
    MODEL,
  );
  return suite.score(golden.input, replayed, golden.expected);
}

/** The scorers behind a case's hard failures, as `evalSuite` reports them. */
const failingHard = (scores: Score[]) => [
  ...new Set(hardFailures(scores).map((failure) => failure.slice(0, failure.indexOf(':')))),
];

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

  it('fail a summary that invents a number and an item and uses verdict language', async () => {
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

describe('narrative validation on recorded fixtures', () => {
  const CASE = 'FY2026, all sections, two prior years';
  const narrative = {
    paragraphs: [
      {
        section: 'overview',
        text: 'In FY2025/26, 14,854 of 15,910 expected declarations were filed, a filing rate of 93.4%.',
        aggregateRefs: ['national.filed', 'national.expected', 'national.filingRate'],
        candidateIds: [],
      },
      {
        section: 'findings',
        text: "The Teachers Service Commission's non-filer rate doubled, from 4.1% to 8.2%.",
        aggregateRefs: ['fy2025.commission.tsc.nonFilerRate', 'commission.tsc.nonFilerRate'],
        candidateIds: ['rate-change:tsc:nonFilerRate'],
      },
      {
        section: 'recommendations',
        text: 'EACC should ask the Teachers Service Commission to account for its non-filers.',
        aggregateRefs: ['commission.tsc.nonFilerRate'],
        candidateIds: ['rate-change:tsc:nonFilerRate'],
      },
    ],
  };
  type Paragraph = (typeof narrative.paragraphs)[number];
  const tampered = (index: number, changes: Partial<Paragraph>) => ({
    paragraphs: narrative.paragraphs.map((each, at) =>
      at === index ? { ...each, ...changes } : each,
    ),
  });

  it('passes a sound narrative', async () => {
    expect(failingHard(await scoreRecorded('narrate-compliance-report', CASE, narrative))).toEqual(
      [],
    );
  });

  it.each([
    ['a foreign number', tampered(0, { text: 'In FY2025/26, 14,900 declarations were filed.' })],
    ['an invented key', tampered(1, { aggregateRefs: ['commission.kdf.nonFilerRate'] })],
    ['an invented candidate', tampered(1, { candidateIds: ['rate-change:kdf:nonFilerRate'] })],
    ['a missing section', { paragraphs: narrative.paragraphs.slice(0, 2) }],
  ])('fails a narrative with %s', async (_, broken) => {
    expect(failingHard(await scoreRecorded('narrate-compliance-report', CASE, broken))).toEqual([
      'narrative-valid',
    ]);
  });

  it('fails a draft of findings with a paragraph from another section', async () => {
    const findings = 'FY2026 findings';
    const broken = { paragraphs: narrative.paragraphs.slice(1) };
    expect(failingHard(await scoreRecorded('narrate-compliance-report', findings, broken))).toEqual(
      ['narrative-valid'],
    );
  });
});

describe('recorded fixtures', () => {
  it('miss when the output schema, the prompt or the model changes', async () => {
    const { suite, golden } = goldenCase('summarize-declaration', 'household amendment');
    const replay = new ReplayAdapter({
      fixturesDir: await record('summarize-declaration', 'household amendment', summary),
      mode: 'replay',
    });
    const schema = { ...suite.task.outputJsonSchema, description: 'changed' };
    const changes = [
      { ...suite.task, outputJsonSchema: schema },
      { ...suite.task, prompt: () => `${suite.task.prompt(1)}\nOne more rule.` },
    ];
    for (const task of changes) {
      await expect(runTask(task, golden.input, replay, MODEL)).rejects.toThrow(
        ReplayFixtureMissingError,
      );
    }
    await expect(runTask(suite.task, golden.input, replay, 'another-model')).rejects.toThrow(
      ReplayFixtureMissingError,
    );
    await expect(runTask(suite.task, golden.input, replay, MODEL)).resolves.toBeDefined();
  });
});

describe('a streamed answer (ADR-019)', () => {
  /** Records `text`, cut into small chunks, as the stream for a golden case; replays and scores it. */
  async function scoreStreamed(caseName: string, text: string): Promise<Score[]> {
    const { suite, golden } = goldenCase('answer-declarant-question', caseName);
    const dir = await mkdtemp(join(fixturesDir, 'stream-'));
    const inner = new ScriptedStreamProvider('external');
    inner.scripts = [{ chunks: text.match(/[\s\S]{1,9}/g) ?? [], end: { status: 'completed' } }];
    await runCase(
      suite.task,
      golden.input,
      new ReplayAdapter({ fixturesDir: dir, mode: 'record', inner }),
      MODEL,
    );
    const { output, violations } = await runCase(
      suite.task,
      golden.input,
      new ReplayAdapter({ fixturesDir: dir, mode: 'replay' }),
      MODEL,
    );
    return suite.score(golden.input, output, golden.expected, violations);
  }

  it('passes a sound answer and fails one that cites, values and judges what it should not', async () => {
    const sound =
      '<block>Yes. Joint assets should be declared, in Kenya or outside it. <cite ids="act-sch1-note-13"/></block>';
    expect(failingHard(await scoreStreamed('matatu co-owned with a brother (en)', sound))).toEqual(
      [],
    );

    const broken =
      '<block>Yes, it is worth about 850,000 and you are fully compliant. <cite ids="act-s99"/></block>';
    expect(failingHard(await scoreStreamed('matatu co-owned with a brother (en)', broken))).toEqual(
      ['no-invented-numbers', 'no-judgement', 'passages-resolve'],
    );
  });

  it('fails an answer to a question the corpus cannot answer', async () => {
    const answered = '<block>Rent is taxed as income. <cite ids="act-sch1-para-8"/></block>';
    expect(failingHard(await scoreStreamed('tax rate on rent (en)', answered))).toEqual([
      'decline-cases-decline',
    ]);
    expect(failingHard(await scoreStreamed('tax rate on rent (en)', '<declined/>'))).toEqual([]);
  });
});
