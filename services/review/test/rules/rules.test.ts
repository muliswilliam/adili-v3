import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  band,
  type Flag,
  match,
  RULES,
  runRules,
  type RulesInput,
  score,
} from '../../src/rules/index.js';
import {
  asset,
  declaration,
  income,
  liability,
  revalued,
  SPOUSE,
  statement,
} from '../fixtures/declarations.js';

// Income large enough that land revaluations alone do not outgrow it.
const salary = income({ amount: { kesCents: 2_000_000_000 } });
const land = asset();

/** A previous version with a salary and a plot, and the current one built from it. */
function versions(edit: (current: { officer: ReturnType<typeof statement> }) => void) {
  const previous = declaration([statement('officer', { income: [salary], assets: [land] })]);
  const officer = statement('officer', {
    income: [revalued(salary, 2_000_000_000)],
    assets: [revalued(land, 1_000_000_000)],
  });
  edit({ officer });
  return { previous, current: declaration([officer]) };
}

/** Every input the tests run, so the evidence test below covers all of them. */
const runs: RulesInput[] = [];
function run(input: RulesInput): Flag[] {
  runs.push(input);
  return runRules(input);
}

/** Flags as `ruleId severity`, for compact tables. */
const summary = (flags: Flag[]) => flags.map((flag) => `${flag.ruleId} ${flag.severity}`);

describe('match', () => {
  it('pairs items by person, category, type and description, ignoring case, spacing and punctuation', () => {
    const previous = declaration([
      statement('officer', { assets: [asset({ description: 'Plot in Kisumu.' })] }),
    ]);
    const current = declaration([
      statement('officer', { assets: [asset({ description: '  plot in  KISUMU' })] }),
    ]);

    const result = match(previous, current);

    expect(result.matched).toHaveLength(1);
    expect(result.onlyPrevious).toEqual([]);
    expect(result.onlyCurrent).toEqual([]);
  });

  it.each([
    ['a different type', { type: 'building' as const }],
    ['a different description', { description: 'Plot in Nakuru' }],
  ])('leaves items with %s unmatched', (_name, change) => {
    const previous = declaration([statement('officer', { assets: [asset()] })]);
    const current = declaration([statement('officer', { assets: [asset(change)] })]);

    const result = match(previous, current);

    expect([result.matched.length, result.onlyPrevious.length, result.onlyCurrent.length]).toEqual([
      0, 1, 1,
    ]);
  });

  it('keeps the same item of two people apart', () => {
    const previous = declaration([
      statement('officer', { assets: [asset()] }),
      statement(SPOUSE, { assets: [asset()] }),
    ]);
    const current = declaration([statement(SPOUSE, { assets: [asset()] })]);

    const result = match(previous, current);

    expect(result.matched.map((pair) => pair.personKey)).toEqual([SPOUSE]);
    expect(result.onlyPrevious.map((ref) => ref.personKey)).toEqual(['officer']);
  });
});

describe('runRules', () => {
  it('S1: records a first declaration and nothing else; band low', () => {
    const flags = run({ current: declaration([statement('officer', { income: [salary] })]) });

    expect(summary(flags)).toEqual(['no-previous-version info']);
    expect(band(score(flags))).toBe('low');
  });

  it('S1: notes foreign holdings on a first declaration', () => {
    const abroad = asset({ type: 'bank-account', location: { inKenya: false, country: 'US' } });
    const flags = run({ current: declaration([statement('officer', { assets: [abroad] })]) });

    expect(summary(flags)).toEqual(['no-previous-version info', 'foreign-holdings info']);
    expect(flags[1]?.evidence).toEqual({ items: 1, countries: ['US'] });
    expect(band(score(flags))).toBe('low');
  });

  it.each([
    [
      'S2: +30% without a change flag',
      1_300_000_000,
      { changed: false },
      ['value-change-25 medium', 'change-flag-mismatch low'],
      'medium',
    ],
    [
      'S2: +150% without a change flag',
      2_500_000_000,
      { changed: false },
      ['value-change-25 high', 'change-flag-mismatch low'],
      'medium',
    ],
    [
      'a flagged +30%',
      1_300_000_000,
      { changed: true, kind: 'value-change', explanation: 'Revalued by a surveyor.' },
      ['value-change-25 medium'],
      'medium',
    ],
    [
      'a flagged change the comparison does not show (+10%)',
      1_100_000_000,
      { changed: true, kind: 'value-change', explanation: 'Revalued.' },
      ['change-flag-mismatch low'],
      'low',
    ],
    ['an unflagged -20%', 800_000_000, { changed: false }, [], 'low'],
  ] as const)('%s', (_name, kesCents, change, expected, expectedBand) => {
    const { previous, current } = versions(({ officer }) => {
      officer.assets = [{ ...revalued(land, kesCents), change: { ...change } }];
    });

    const flags = run({ current, previous });

    expect(summary(flags)).toEqual(expected);
    expect(band(score(flags))).toBe(expectedBand);
  });

  it('treats a value up from zero as a change of more than 100%, with no percentage to give', () => {
    const { previous, current } = versions(({ officer }) => {
      officer.assets = [
        revalued(land, 1_000_000_000),
        asset({
          type: 'receivable',
          description: 'Loan to a friend',
          value: { kesCents: 50_000_000 },
        }),
      ];
    });
    previous.statements[0]?.assets.push(
      asset({ type: 'receivable', description: 'Loan to a friend', value: { kesCents: 0 } }),
    );

    const flags = run({ current, previous });

    expect(summary(flags)).toEqual(['value-change-25 high', 'change-flag-mismatch low']);
    expect(flags[0]?.evidence).toEqual({ changePercent: null, direction: 'up' });
  });

  it.each([
    ['+24.6% is under the threshold', 1_246_000_000, []],
    ['+100.4% is above 100%', 2_004_000_000, ['value-change-25 high', 'change-flag-mismatch low']],
  ] as const)('compares before rounding: %s', (_name, kesCents, expected) => {
    const { previous, current } = versions(({ officer }) => {
      officer.assets = [revalued(land, kesCents)];
    });

    expect(summary(run({ current, previous }))).toEqual(expected);
  });

  it('counts a change marked as an acquisition on an item declared before as a mismatch', () => {
    const { previous, current } = versions(({ officer }) => {
      officer.assets = [
        {
          ...revalued(land, 1_300_000_000),
          change: { changed: true, kind: 'acquisition', explanation: 'Bought more land.' },
        },
      ];
    });

    expect(summary(run({ current, previous }))).toEqual([
      'value-change-25 medium',
      'change-flag-mismatch low',
    ]);
  });

  it('S2: gives the change as a whole percentage, never the amounts', () => {
    const { previous, current } = versions(({ officer }) => {
      officer.assets = [revalued(land, 1_413_000_000)];
    });

    const [flag] = run({ current, previous });

    expect(flag?.evidence).toEqual({ changePercent: 41, direction: 'up' });
    expect(flag?.itemRefs).toEqual([
      {
        personKey: 'officer',
        itemId: current.statements[0]?.assets[0]?.id,
        sectionKey: 'statement:officer',
      },
    ]);
  });

  it.each([
    [
      'S3: an item only in the previous version, no disposal recorded',
      'unrecorded',
      ['disposal-unflagged medium'],
    ],
    ['an item only in the previous version, disposal recorded in paragraph 9', 'recorded', []],
  ] as const)('%s', (_name, disposal, expected) => {
    const car = asset({
      type: 'vehicle',
      description: 'Toyota Prado',
      value: { kesCents: 600_000_000 },
    });
    const previous = declaration([statement('officer', { income: [salary], assets: [land, car] })]);
    const current = declaration(
      [
        statement('officer', {
          income: [revalued(salary, 2_000_000_000)],
          assets: [revalued(land, 1_000_000_000)],
        }),
      ],
      disposal === 'recorded'
        ? [{ personKey: 'officer', itemId: car.id, kind: 'disposal', explanation: 'Sold in 2026.' }]
        : [],
    );

    expect(summary(run({ current, previous }))).toEqual(expected);
  });

  it('does not accept a settlement in paragraph 9 for an asset no longer declared', () => {
    const car = asset({ type: 'vehicle', description: 'Toyota Prado' });
    const previous = declaration([statement('officer', { income: [salary], assets: [land, car] })]);
    const current = declaration(
      [
        statement('officer', {
          income: [revalued(salary, 2_000_000_000)],
          assets: [revalued(land, 1_000_000_000)],
        }),
      ],
      [
        {
          personKey: 'officer',
          itemDescription: 'Toyota Prado',
          kind: 'settled',
          explanation: 'Paid off.',
        },
      ],
    );

    expect(summary(run({ current, previous }))).toEqual(['disposal-unflagged medium']);
  });

  it('flags the items of a person no longer in the declaration', () => {
    const previous = declaration([
      statement('officer', { income: [salary], assets: [land] }),
      statement(SPOUSE, { assets: [asset({ type: 'vehicle', description: 'Toyota Vitz' })] }),
    ]);
    const current = declaration([
      statement('officer', {
        income: [revalued(salary, 2_000_000_000)],
        assets: [revalued(land, 1_000_000_000)],
      }),
    ]);

    const flags = run({ current, previous });

    expect(summary(flags)).toEqual(['disposal-unflagged medium']);
    expect(flags[0]?.itemRefs[0]?.personKey).toBe(SPOUSE);
  });

  it.each([
    [
      'S3: a new asset flagged as an acquisition',
      { changed: true, kind: 'acquisition', explanation: 'Bought in 2026.' },
      [],
    ],
    ['a new asset not flagged', { changed: false }, ['acquisition-unflagged medium']],
  ] as const)('%s', (_name, change, expected) => {
    const { previous, current } = versions(({ officer }) => {
      officer.assets = [
        revalued(land, 1_000_000_000),
        asset({
          type: 'vehicle',
          description: 'Toyota Prado',
          value: { kesCents: 100_000_000 },
          change: { ...change },
        }),
      ];
    });

    expect(summary(run({ current, previous }))).toEqual(expected);
  });

  it('expects a new income source to be flagged as one, and a new liability as an acquisition', () => {
    const { previous, current } = versions(({ officer }) => {
      officer.income = [
        revalued(salary, 2_000_000_000),
        income({
          type: 'rent',
          description: 'Rent',
          change: { changed: true, kind: 'new-source', explanation: 'Let a flat.' },
        }),
      ];
      officer.liabilitiesNil = false;
      officer.liabilities = [liability()];
    });

    expect(summary(run({ current, previous }))).toEqual(['acquisition-unflagged medium']);
  });

  it('S3: a category declared nil after the previous version listed items', () => {
    const { previous, current } = versions(({ officer }) => {
      officer.assetsNil = true;
      officer.assets = [];
    });

    const flags = run({ current, previous });

    expect(summary(flags)).toEqual(['nil-after-populated medium']);
    expect(flags[0]?.evidence).toEqual({ category: 'assets', previousItems: 1 });
    expect(flags[0]?.itemRefs).toEqual([
      { personKey: 'officer', itemId: null, sectionKey: 'statement:officer' },
    ]);
  });

  it.each([
    [
      'S4: asset growth four times income',
      480_000_000,
      1_000_000_000 + 4 * 480_000_000,
      ['value-change-25 high', 'change-flag-mismatch low', 'income-vs-asset-growth high'],
    ],
    [
      'asset growth twice income',
      480_000_000,
      1_000_000_000 + 2 * 480_000_000,
      ['value-change-25 medium', 'change-flag-mismatch low', 'income-vs-asset-growth medium'],
    ],
    [
      'asset growth below income',
      480_000_000,
      1_000_000_000 + 400_000_000,
      ['value-change-25 medium', 'change-flag-mismatch low'],
    ],
  ] as const)('%s', (_name, incomeCents, landCents, expected) => {
    const pay = income({ amount: { kesCents: incomeCents } });
    const previous = declaration([statement('officer', { income: [pay], assets: [land] })]);
    const current = declaration([
      statement('officer', {
        income: [revalued(pay, incomeCents)],
        assets: [revalued(land, landCents)],
      }),
    ]);

    expect(summary(run({ current, previous }))).toEqual(expected);
  });

  it('S4: gives income against growth as a ratio', () => {
    const pay = income({ amount: { kesCents: 480_000_000 } });
    const previous = declaration([statement('officer', { income: [pay], assets: [land] })]);
    const current = declaration([
      statement('officer', {
        income: [revalued(pay, 480_000_000)],
        assets: [revalued(land, 1_000_000_000 + 4 * 480_000_000)],
      }),
    ]);

    const growth = run({ current, previous }).find(
      (flag) => flag.ruleId === 'income-vs-asset-growth',
    );

    expect(growth?.evidence).toEqual({ growthToIncome: 4 });
  });

  it('S4: compares the growth ratio before rounding (3.04 times is above three)', () => {
    const pay = income({ amount: { kesCents: 480_000_000 } });
    const previous = declaration([statement('officer', { income: [pay], assets: [land] })]);
    const current = declaration([
      statement('officer', {
        income: [revalued(pay, 480_000_000)],
        assets: [revalued(land, 1_000_000_000 + 1_459_200_000)],
      }),
    ]);

    const growth = run({ current, previous }).find(
      (flag) => flag.ruleId === 'income-vs-asset-growth',
    );

    expect(growth?.severity).toBe('high');
  });

  it('S4: a late version', () => {
    const { previous, current } = versions(() => undefined);

    const flags = run({
      current,
      previous,
      late: { dueDate: '2027-12-31', submittedOn: '2028-01-09' },
    });

    expect(summary(flags)).toEqual(['late-filing low']);
    expect(flags[0]?.evidence).toEqual({
      dueDate: '2027-12-31',
      submittedOn: '2028-01-09',
      daysLate: 9,
    });
  });

  it.each([
    ['shares that sum to 100%', [50, 50], []],
    ['shares that do not', [50, 30], ['joint-share-inconsistent info']],
    [
      'shares that do not, one side typed as a building',
      [50, 30],
      ['joint-share-inconsistent info'],
    ],
  ] as const)('joint shares of one asset across the household: %s', (name, shares, expected) => {
    const joint = (sharePercent: number, type: 'land' | 'building' = 'land') =>
      asset({ type, joint: { isJoint: true, sharePercent, coOwner: 'Spouse' } });
    const current = declaration([
      statement('officer', { assets: [joint(shares[0])] }),
      statement(SPOUSE, {
        assets: [joint(shares[1], name.includes('building') ? 'building' : 'land')],
      }),
    ]);

    const flags = run({ current }).filter((flag) => flag.ruleId !== 'no-previous-version');

    expect(summary(flags)).toEqual(expected);
  });

  it('records schema issues tolerated at submission', () => {
    const flags = run({ current: declaration([statement('officer')]), schemaIssues: 2 });

    expect(summary(flags)).toEqual(['completeness-residual info', 'no-previous-version info']);
    expect(flags[0]?.evidence).toEqual({ issues: 2 });
  });
});

describe('evidence', () => {
  // Runs after every test above, over every input they ran.
  it('never carries an amount or a description, over every fixture run in this file', () => {
    expect(runs.length).toBeGreaterThan(20);
    for (const { current, previous } of runs) {
      const amounts = new Set<number>();
      const texts = new Set<string>();
      for (const document of [current, previous]) {
        for (const s of document?.statements ?? []) {
          for (const item of [...s.income, ...s.assets, ...s.liabilities]) {
            texts.add(item.description);
            const money =
              'amount' in item ? item.amount : 'value' in item ? item.value : item.outstanding;
            if (money.kesCents > 0) {
              amounts.add(money.kesCents);
              amounts.add(Math.round(money.kesCents / 100));
            }
          }
        }
      }

      const values = runRules({ current, previous }).flatMap((flag) =>
        Object.values(flag.evidence).flat(),
      );

      expect(
        values.filter((value) =>
          typeof value === 'number' ? amounts.has(value) : texts.has(String(value)),
        ),
      ).toEqual([]);
    }
  });
});

describe('score and band', () => {
  it.each([
    [[], 0, 'low'],
    [['info', 'low', 'low'], 2, 'low'],
    [['medium'], 3, 'medium'],
    [['high', 'low', 'low'], 9, 'medium'],
    [['high', 'medium'], 10, 'high'],
  ] as const)('%j scores %i, band %s', (severities, expectedScore, expectedBand) => {
    const flags = severities.map((severity) => ({ severity }));

    expect(score(flags)).toBe(expectedScore);
    expect(band(score(flags))).toBe(expectedBand);
  });
});

describe('RULES registry', () => {
  it('gives every deterministic rule in review.yaml a title and an indicator, worded as an indicator', () => {
    const require = createRequire(import.meta.url);
    const contract = parse(
      readFileSync(
        join(dirname(require.resolve('@adili/schemas/package.json')), 'internal/review.yaml'),
        'utf8',
      ),
    ) as { components: { schemas: { RuleId: { enum: string[] } } } };
    // The epic's deterministic rules; the contract also lists 07b's registry checks.
    const deterministic = [
      'completeness-residual',
      'no-previous-version',
      'value-change-25',
      'acquisition-unflagged',
      'disposal-unflagged',
      'change-flag-mismatch',
      'income-vs-asset-growth',
      'nil-after-populated',
      'late-filing',
      'foreign-holdings',
      'joint-share-inconsistent',
    ];

    expect(Object.keys(RULES)).toEqual(deterministic);
    expect(
      deterministic.filter((id) => !contract.components.schemas.RuleId.enum.includes(id)),
    ).toEqual([]);
    for (const rule of Object.values(RULES)) {
      expect(rule.title.length).toBeGreaterThan(5);
      expect(rule.indicator).not.toMatch(/\b(fraud|corrupt|guilty|wrongdoing|violat)/iu);
    }
  });
});
