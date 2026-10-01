import type { AssetItem, IncomeItem, PersonName, Statement } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import {
  band,
  type Flag,
  householdIds,
  matchRegistries,
  type PersonRegistryResults,
  type RegistryMatch,
  type RegistryMatchInput,
  registryRows,
  runRules,
  score,
} from '../../src/rules/index.js';
import { declaration, income, statement } from '../fixtures/declarations.js';
import {
  BARAKA_KEY,
  type Household,
  IMANI_KEY,
  land,
  shares,
  SPOUSE,
  twoYears,
  vehicle,
  wanjikuDocument,
  wanjikuHousehold,
} from '../fixtures/households.js';
import {
  AMINA,
  BARAKA,
  brsResult,
  IMANI,
  KEMSA_SUPPLIERS,
  KIPRONO,
  kraResult,
  PETER,
  PSC_SUPPLIERS,
  type SeededPerson,
  supplierCheck,
  WANJIKU,
} from '../fixtures/registries.js';

/** The matching input for Wanjiku's household, every lookup answered as the seed has it. */
function wanjiku(
  edit: (household: Household) => void = () => undefined,
  options: { barakaId?: string; officer?: Partial<PersonRegistryResults> } = {},
): RegistryMatchInput {
  const household = wanjikuHousehold();
  edit(household);
  const document = wanjikuDocument(
    household,
    'barakaId' in options ? { baraka: options.barakaId } : {},
  );
  return {
    document,
    householdIds: householdIds(document, WANJIKU.nationalId),
    results: {
      officer: { ...WANJIKU.results(), ...options.officer },
      [SPOUSE]: PETER.results(),
      [IMANI_KEY]: IMANI.results(),
      [BARAKA_KEY]: BARAKA.results(),
    },
    suppliers: KEMSA_SUPPLIERS(),
  };
}

/** A lone declarant: their statement, their seeded lookups, their employer's supplier checks. */
function declarant(
  person: SeededPerson,
  officer: Statement,
  overrides: Partial<PersonRegistryResults> = {},
  suppliers: RegistryMatchInput['suppliers'] = PSC_SUPPLIERS(),
): RegistryMatchInput {
  const document = declaration([officer]);
  return {
    document,
    householdIds: householdIds(document, person.nationalId),
    results: { officer: { ...person.results(), ...overrides } },
    suppliers,
  };
}

/**
 * Matches, and checks on every run in this file that no flag's or note's evidence carries an
 * amount (declared or KRA), a share count, or a name: a person's, a company's, a vehicle's make
 * or model, or a declared description. Evidence is identifiers, counts, percentages, statuses.
 */
function run(input: RegistryMatchInput): RegistryMatch {
  const result = matchRegistries(input);
  const amounts = new Set<number>();
  const addAmount = (cents: number | null) => {
    if (cents) amounts.add(cents).add(Math.round(cents / 100));
  };
  const addCount = (count: number | null) => {
    if (count) amounts.add(count);
  };
  const names: string[] = [];
  const addNames = (...values: (string | undefined)[]) =>
    names.push(...values.flatMap((value) => (value && value.length >= 3 ? [value] : [])));
  const addPerson = ({ surname, firstName, otherNames }: PersonName) =>
    addNames(surname, firstName, otherNames);
  const { document } = input;
  addPerson(document.officer.name);
  for (const person of [...document.spouses.items, ...document.children.items]) {
    addPerson(person.name);
  }
  for (const s of document.statements) {
    addPerson(s.personName);
    for (const item of [...s.income, ...s.assets, ...s.liabilities]) {
      addNames(item.description);
      if ('details' in item) addNames(item.details?.issuer, item.details?.makeModel);
      addAmount(
        'amount' in item
          ? item.amount.kesCents
          : 'value' in item
            ? item.value.kesCents
            : item.outstanding.kesCents,
      );
    }
  }
  const interests = document.otherInformation.registrableInterests;
  addNames(
    ...interests.directorships.map((d) => d.company),
    ...interests.memberships.map((m) => m.entity),
  );
  for (const { kra, ntsa, brs } of Object.values(input.results).flatMap((r) => r ?? [])) {
    if (kra && 'taxpayers' in kra) {
      for (const t of kra.taxpayers) addAmount(t.compliance.annualIncomeDeclaredCents);
    }
    if (ntsa && 'vehicles' in ntsa) for (const v of ntsa.vehicles) addNames(v.make, v.model);
    if (brs && 'directorships' in brs) {
      for (const d of brs.directorships) {
        addNames(d.companyName);
        addCount(d.shares);
      }
    }
  }
  const values = [...result.flags, ...result.notes].flatMap((entry) =>
    Object.values(entry.evidence).flat(),
  );
  const leaked = values.filter((value) =>
    typeof value === 'number'
      ? amounts.has(value)
      : typeof value === 'string' &&
        names.some((name) => value.toLowerCase().includes(name.toLowerCase())),
  );
  expect(leaked, 'evidence carries an amount or a name').toEqual([]);
  return result;
}

/** Flags as `ruleId severity`, for compact tables. */
const summary = (flags: Flag[]) => flags.map((flag) => `${flag.ruleId} ${flag.severity}`);

/** Each person's statuses as `system status`, for compact tables. */
const statuses = (match: RegistryMatch, personKey: string) =>
  match.checks
    .filter((check) => check.personKey === personKey)
    .map((check) => `${check.system} ${check.status}`);

const officerStatement = (overrides: { income?: IncomeItem[]; assets?: AssetItem[] } = {}) =>
  statement('officer', { income: [twoYears(2_640_000)], ...overrides });

describe('matchRegistries: the demo', () => {
  it('S4, S5: Wanjiku Kamau shows the undeclared Prado, the Kajiado parcel and the supplier directorship', () => {
    const match = run(wanjiku());

    expect(summary(match.flags)).toEqual([
      'registry-vehicle-undeclared medium',
      'directorship-employer-supplier high',
      'registry-parcel-undeclared high',
    ]);
    expect(match.flags.map((flag) => flag.evidence)).toEqual([
      { registrationNumber: 'KDK 482M' },
      { companyRegistrationNumber: 'PVT-9XYZ2L4Q', role: 'director_shareholder', declared: true },
      { parcelNumber: 'KAJIADO/KITENGELA/59821' },
    ]);
    expect(match.flags.flatMap((flag) => flag.itemRefs)).toEqual([
      { personKey: 'officer', itemId: null, sectionKey: 'statement:officer' },
      { personKey: 'officer', itemId: null, sectionKey: 'other' },
      { personKey: 'officer', itemId: null, sectionKey: 'statement:officer' },
    ]);
    expect(statuses(match, 'officer')).toEqual([
      'kra matched',
      'ntsa mismatched',
      'brs mismatched',
      'ardhisasa mismatched',
    ]);
    for (const personKey of [SPOUSE, IMANI_KEY, BARAKA_KEY]) {
      expect(statuses(match, personKey)).toEqual([
        'kra matched',
        'ntsa matched',
        'brs matched',
        'ardhisasa matched',
      ]);
    }
    expect(match.notes).toEqual([]);
  });

  it('S6: Kiprono Chebet, who declared all his holdings, shows the KRA non-compliance only', () => {
    const match = run(
      declarant(
        KIPRONO,
        officerStatement({
          assets: [
            vehicle('KDA 118Q', 'Nissan X-Trail'),
            land('NAIROBI/BLOCK 82/1934'),
            shares('Rift Valley Agrovet Limited, PVT-3KLM8R2T'),
          ],
        }),
      ),
    );

    expect(summary(match.flags)).toEqual(['kra-non-compliant medium']);
    expect(match.flags[0]?.evidence).toEqual({
      pinPresent: true,
      pins: 1,
      complianceStatus: 'non-compliant',
    });
    expect(statuses(match, 'officer')).toEqual([
      'kra mismatched',
      'ntsa matched',
      'brs matched',
      'ardhisasa matched',
    ]);
  });

  it('a clean officer with empty registry lists is matched everywhere', () => {
    const match = run(declarant(AMINA, statement('officer', { income: [twoYears(1_680_000)] })));

    expect(match.flags).toEqual([]);
    expect(statuses(match, 'officer')).toEqual([
      'kra matched',
      'ntsa matched',
      'brs matched',
      'ardhisasa matched',
    ]);
  });

  it('S8: the score and band include the registry flags with the deterministic ones', () => {
    const input = wanjiku();
    const rules = runRules({ current: input.document });
    const registry = run(input).flags;

    expect(band(score(rules))).toBe('low');
    expect(score([...rules, ...registry])).toBe(17);
    expect(band(score([...rules, ...registry]))).toBe('high');
  });
});

describe('matchRegistries: land (ArdhiSasa)', () => {
  it.each([
    [
      'S4: both parcels declared',
      ['KIAMBU/RUIRU EAST BLOCK 2/4417', 'KAJIADO/KITENGELA/59821'],
      [],
    ],
    [
      'S4: a registered parcel not declared',
      ['KIAMBU/RUIRU EAST BLOCK 2/4417'],
      ['registry-parcel-undeclared high'],
    ],
    [
      'S4: a declared parcel number ArdhiSasa does not know',
      ['KIAMBU/RUIRU EAST BLOCK 2/4417', 'KAJIADO/KITENGELA/59821', 'NAKURU/NJORO/1187'],
      ['declared-parcel-not-found medium'],
    ],
    [
      'parcel numbers compared without case, spaces or separators',
      ['kiambu/ruiru east block 2/4417', 'Kajiado / Kitengela / 59821'],
      [],
    ],
  ] as const)('%s', (_name, declared, expected) => {
    const match = run(
      wanjiku((h) => {
        h.officer.assets = [
          vehicle('KCX 214J'),
          vehicle('KDK 482M'),
          ...declared.map((p) => land(p)),
        ];
      }),
    );

    expect(summary(match.flags.filter((flag) => flag.ruleId.includes('parcel')))).toEqual(expected);
  });

  it('S4: a declared parcel not found points at the item and gives the declared number', () => {
    const input = wanjiku((h) => {
      h.officer.assets.push(land('KAJIADO/KITENGELA/59821'), land('NAKURU/NJORO/1187'));
    });
    const unknown = input.document.statements[0]?.assets.at(-1);

    const [flag] = run(input).flags.filter((f) => f.ruleId === 'declared-parcel-not-found');

    expect(flag?.evidence).toEqual({ parcelNumber: 'NAKURU/NJORO/1187' });
    expect(flag?.itemRefs).toEqual([
      { personKey: 'officer', itemId: unknown?.id, sectionKey: 'statement:officer' },
    ]);
  });

  it('matches a declared building by its parcel number', () => {
    const match = run(
      wanjiku((h) => {
        h.officer.assets.push(land('KAJIADO/KITENGELA/59821', 'building'));
      }),
    );

    expect(match.flags.filter((flag) => flag.ruleId.includes('parcel'))).toEqual([]);
  });

  it('notes land declared without a parcel number and raises no flag on it', () => {
    const input = wanjiku((h) => {
      h.officer.assets.push(land(undefined));
    });

    const match = run(input);

    expect(summary(match.flags.filter((flag) => flag.ruleId.includes('parcel')))).toEqual([
      // The Kajiado parcel still has no declared item to pair with.
      'registry-parcel-undeclared high',
    ]);
    expect(match.notes).toEqual([
      {
        kind: 'parcel-number-missing',
        system: 'ardhisasa',
        evidence: {},
        itemRefs: [
          {
            personKey: 'officer',
            itemId: input.document.statements[0]?.assets.at(-1)?.id,
            sectionKey: 'statement:officer',
          },
        ],
      },
    ]);
  });
});

describe('matchRegistries: vehicles (NTSA)', () => {
  it.each([
    ['both vehicles declared', ['KCX 214J', 'KDK 482M'], []],
    ['S4: a registered vehicle not declared', ['KCX 214J'], ['registry-vehicle-undeclared medium']],
    [
      'a declared registration NTSA does not know',
      ['KCX 214J', 'KDK 482M', 'KCA 123A'],
      ['declared-vehicle-not-found low'],
    ],
    ['registrations compared without case or spaces', ['kcx214j', 'KDK-482M'], []],
  ] as const)('%s', (_name, declared, expected) => {
    const match = run(
      wanjiku((h) => {
        h.officer.assets = [
          land('KIAMBU/RUIRU EAST BLOCK 2/4417'),
          land('KAJIADO/KITENGELA/59821'),
          ...declared.map((registration) => vehicle(registration)),
        ];
      }),
    );

    expect(summary(match.flags.filter((flag) => flag.ruleId.includes('vehicle')))).toEqual(
      expected,
    );
  });

  it('notes a vehicle declared without a registration', () => {
    const match = run(wanjiku((h) => h.officer.assets.push(vehicle(undefined, 'Toyota Prado'))));

    expect(match.notes.map((note) => `${note.system} ${note.kind}`)).toEqual([
      'ntsa vehicle-registration-missing',
    ]);
  });
});

describe('matchRegistries: companies (BRS)', () => {
  it.each([
    [
      'declared in paragraph 9 with its registration number',
      'directorship',
      'Afya Bora (PVT-9XYZ2L4Q)',
      [],
    ],
    [
      'declared as a shareholding by its exact name',
      'shareholding',
      'Afya Bora Medical Supplies Ltd.',
      [],
    ],
    ['registration written with other separators', 'shareholding', 'pvt 9xyz2l4q', []],
    ['S5: not declared', 'none', '', ['registry-directorship-undeclared medium']],
    [
      'declared under another name, with no registration number',
      'shareholding',
      'Afya Medical',
      ['registry-directorship-undeclared medium'],
    ],
  ] as const)('%s', (_name, where, text, expected) => {
    const match = run(
      wanjiku((h) => {
        h.directorships = [];
        if (where === 'directorship') {
          h.directorships = [{ company: text, role: 'Director', remunerated: false }];
        }
        if (where === 'shareholding') h.officer.assets.push(shares(text));
      }),
    );

    expect(
      summary(match.flags.filter((flag) => flag.ruleId === 'registry-directorship-undeclared')),
    ).toEqual(expected);
  });

  it('S5: an undeclared directorship in a supplier raises both flags, the supplier one on the statement', () => {
    const match = run(wanjiku((h) => (h.directorships = [])));
    const brs = match.flags.filter(
      (flag) => !flag.ruleId.includes('vehicle') && !flag.ruleId.includes('parcel'),
    );

    expect(summary(brs)).toEqual([
      'registry-directorship-undeclared medium',
      'directorship-employer-supplier high',
    ]);
    expect(brs.map((flag) => flag.evidence)).toEqual([
      { companyRegistrationNumber: 'PVT-9XYZ2L4Q', role: 'director_shareholder' },
      { companyRegistrationNumber: 'PVT-9XYZ2L4Q', role: 'director_shareholder', declared: false },
    ]);
    expect(brs[1]?.itemRefs).toEqual([
      { personKey: 'officer', itemId: null, sectionKey: 'statement:officer' },
    ]);
  });

  it.each([
    [
      'S5: on the supplier list',
      supplierCheck(true),
      ['directorship-employer-supplier high'],
      'mismatched',
      null,
    ],
    ['not on the supplier list', supplierCheck(false), [], 'matched', null],
    ['not checked (no employer code)', undefined, [], 'matched', null],
    [
      'the supplier check unavailable',
      { outcome: 'unavailable', reason: 'timeout' } as const,
      [],
      'unavailable',
      'supplier-check-unavailable',
    ],
  ] as const)('supplier check: %s', (_name, supplier, expected, status, reason) => {
    const input = wanjiku();
    input.suppliers = supplier ? { 'PVT-9XYZ2L4Q': supplier } : {};

    const match = run(input);
    const brs = match.checks.find((c) => c.personKey === 'officer' && c.system === 'brs');

    expect(
      summary(match.flags.filter((flag) => flag.ruleId === 'directorship-employer-supplier')),
    ).toEqual(expected);
    expect([brs?.status, brs?.reason]).toEqual([status, reason]);
  });

  it('checks the supplier list for the officer only, not a spouse in the same company', () => {
    const match = run(wanjiku());

    expect(match.flags.filter((flag) => flag.itemRefs.some((r) => r.personKey === SPOUSE))).toEqual(
      [],
    );
  });

  it.each([
    ['a shareholding', 'shareholding', ['declared-company-not-found low']],
    ['a directorship in paragraph 9', 'directorship', ['declared-company-not-found low']],
    // Listed securities are held through the CDS, not registered as BRS shareholdings.
    ['securities', 'securities', []],
  ] as const)('a declared registration BRS does not list: %s', (_name, where, expected) => {
    const match = run(
      wanjiku((h) => {
        if (where === 'directorship') {
          h.directorships.push({
            company: 'Kilele Holdings PVT-7QRS5T6U',
            role: 'Director',
            remunerated: true,
          });
        } else {
          h.officer.assets.push(shares('Kilele Holdings PVT-7QRS5T6U', where));
        }
      }),
    );

    const notFound = match.flags.filter((flag) => flag.ruleId === 'declared-company-not-found');
    expect(summary(notFound)).toEqual(expected);
    expect(notFound.map((flag) => flag.evidence)).toEqual(
      expected.map(() => ({ companyRegistrationNumber: 'PVT-7QRS5T6U' })),
    );
  });

  it('notes a declared company without a registration number BRS does not know by name', () => {
    const match = run(wanjiku((h) => h.officer.assets.push(shares('Kilele Holdings'))));

    expect(match.notes.map((note) => `${note.system} ${note.kind}`)).toEqual([
      'brs company-registration-missing',
    ]);
    expect(match.flags.filter((flag) => flag.ruleId === 'declared-company-not-found')).toEqual([]);
  });

  it('notes a declared company BRS lists as dissolved', () => {
    const input = wanjiku(undefined, {
      officer: {
        brs: brsResult([
          [
            'PVT-9XYZ2L4Q',
            'Afya Bora Medical Supplies Limited',
            'dissolved',
            'director',
            400,
            '2022-02-14',
          ],
        ]),
      },
    });

    const match = run(input);

    expect(match.notes).toEqual([
      {
        kind: 'company-dissolved',
        system: 'brs',
        evidence: { companyRegistrationNumber: 'PVT-9XYZ2L4Q' },
        itemRefs: [{ personKey: 'officer', itemId: null, sectionKey: 'other' }],
      },
    ]);
  });
});

describe('matchRegistries: KRA', () => {
  /** Kiprono's KRA answer as given, with nothing in the other registries so only KRA speaks. */
  const onlyKra = (kra: PersonRegistryResults['kra']) => ({ ...AMINA.results(), kra });
  const withKra = (kra: PersonRegistryResults['kra']) =>
    declarant(KIPRONO, officerStatement(), onlyKra(kra));

  it.each([
    ['compliant, income as declared', 'compliant', 2_640_000, [], null],
    ['S6: not compliant', 'non-compliant', 2_640_000, ['kra-non-compliant medium'], null],
    ['compliance unknown', 'unknown', 2_640_000, [], null],
    ['24% below the declared income', 'compliant', 2_006_400, [], null],
    [
      '25% below',
      'compliant',
      1_980_000,
      ['kra-income-mismatch medium'],
      { differencePercent: 25, direction: 'below' },
    ],
    [
      'S6: 40% below',
      'compliant',
      1_584_000,
      ['kra-income-mismatch medium'],
      { differencePercent: 40, direction: 'below' },
    ],
    [
      '100% above',
      'compliant',
      5_280_000,
      ['kra-income-mismatch medium'],
      { differencePercent: 100, direction: 'above' },
    ],
    [
      'S6: 150% above',
      'compliant',
      6_600_000,
      ['kra-income-mismatch high'],
      { differencePercent: 150, direction: 'above' },
    ],
    ['no income figure at KRA', 'compliant', null, [], null],
  ] as const)('%s', (_name, status, kraIncomeKes, expected, evidence) => {
    const match = run(
      withKra(kraResult([{ pin: 'A002260778R', status, annualIncomeKes: kraIncomeKes }])),
    );
    const kra = match.flags.filter((flag) => flag.ruleId.startsWith('kra-'));

    expect(summary(kra)).toEqual(expected);
    if (evidence) expect(kra[0]?.evidence).toEqual(evidence);
  });

  it('compares annual KRA income with the declared income annualised over the income period', () => {
    const input = declarant(
      KIPRONO,
      { ...officerStatement(), incomePeriod: { from: '2026-11-01', to: '2027-11-01' } },
      onlyKra(kraResult([{ pin: 'A002260778R', annualIncomeKes: 2_640_000 }])),
    );

    // Two years' income over one year is twice the KRA figure: KRA is 50% below.
    expect(run(input).flags.map((flag) => flag.evidence)).toEqual([
      { differencePercent: 50, direction: 'below' },
    ]);
  });

  it('S6: income declared to KRA with none declared here is high, with no percentage to give', () => {
    const input = declarant(
      KIPRONO,
      statement('officer'),
      onlyKra(kraResult([{ pin: 'A002260778R', annualIncomeKes: 2_640_000 }])),
    );

    const flags = run(input).flags.filter((flag) => flag.ruleId.startsWith('kra-'));

    expect(summary(flags)).toEqual(['kra-income-mismatch high']);
    expect(flags[0]?.evidence).toEqual({ differencePercent: null, direction: 'above' });
    expect(flags[0]?.itemRefs).toEqual([
      { personKey: 'officer', itemId: null, sectionKey: 'statement:officer' },
    ]);
  });

  it('S6: no PIN for the officer is kra-pin-missing', () => {
    const match = run(withKra(kraResult([])));

    expect(summary(match.flags)).toEqual(['kra-pin-missing medium']);
    expect(match.flags[0]?.evidence).toEqual({ pinPresent: false });
  });

  it.each([
    ['with income declared', true, ['kra-pin-missing medium']],
    ['with no income (the seeded children)', false, []],
  ] as const)('no PIN for a household member %s', (_name, hasIncome, expected) => {
    const input = wanjiku((h) => {
      if (hasIncome) h.imani.income = [income({ type: 'other', description: 'Prize money' })];
      h.imani.incomeNil = !hasIncome;
    });

    const flags = run(input).flags.filter((flag) =>
      flag.itemRefs.some((r) => r.personKey === IMANI_KEY),
    );

    expect(summary(flags)).toEqual(expected);
  });
});

describe('matchRegistries: household and statuses', () => {
  it("S7: a spouse with an ID is checked, with flags on the spouse's statement", () => {
    const match = run(
      wanjiku((h) => {
        h.spouse.assets = h.spouse.assets.filter((item) => item.type !== 'vehicle');
      }),
    );
    const spouseFlags = match.flags.filter((flag) =>
      flag.itemRefs.some((r) => r.personKey === SPOUSE),
    );

    expect(summary(spouseFlags)).toEqual(['registry-vehicle-undeclared medium']);
    expect(spouseFlags[0]?.evidence).toEqual({ registrationNumber: 'KCB 903T' });
    expect(spouseFlags[0]?.itemRefs).toEqual([
      { personKey: SPOUSE, itemId: null, sectionKey: `statement:${SPOUSE}` },
    ]);
    expect(statuses(match, SPOUSE)).toEqual([
      'kra matched',
      'ntsa mismatched',
      'brs matched',
      'ardhisasa matched',
    ]);
  });

  it('S7: a child without an ID is no-id in every system, whatever results are passed', () => {
    const match = run(wanjiku(undefined, { barakaId: undefined }));

    expect(statuses(match, BARAKA_KEY)).toEqual([
      'kra no-id',
      'ntsa no-id',
      'brs no-id',
      'ardhisasa no-id',
    ]);
    expect(match.checks.filter((c) => c.personKey === BARAKA_KEY).map((c) => c.resultId)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(statuses(match, IMANI_KEY)).toEqual([
      'kra matched',
      'ntsa matched',
      'brs matched',
      'ardhisasa matched',
    ]);
  });

  it('records each lookup as unavailable, not checked or answered, with its result id', () => {
    const input = wanjiku(undefined, {
      officer: {
        kra: undefined,
        ardhisasa: {
          resultId: '0192f1a0-7e57-7000-8000-0000000000ff',
          outcome: 'unavailable',
          reason: 'breaker-open',
        },
        // The gateway could not be reached at all after the retries: no result id.
        ntsa: { outcome: 'unavailable', reason: 'upstream-error' },
      },
    });

    const match = run(input);
    const officer = match.checks.filter((c) => c.personKey === 'officer');

    expect(officer.map(({ system, status, reason }) => [system, status, reason])).toEqual([
      ['kra', 'not-checked', null],
      ['ntsa', 'unavailable', 'upstream-error'],
      ['brs', 'mismatched', null],
      ['ardhisasa', 'unavailable', 'breaker-open'],
    ]);
    expect(officer.map((c) => c.resultId)).toEqual([
      null,
      null,
      input.results.officer?.brs?.resultId,
      '0192f1a0-7e57-7000-8000-0000000000ff',
    ]);
    // Nothing is inferred from a registry that did not answer.
    expect(summary(match.flags)).toEqual(['directorship-employer-supplier high']);
  });

  it('householdIds: the officer from the directory, the household as declared, blanks as none', () => {
    const document = wanjikuDocument(wanjikuHousehold(), { baraka: '  ' });

    expect(householdIds(document, WANJIKU.nationalId)).toEqual({
      officer: WANJIKU.nationalId,
      [SPOUSE]: PETER.nationalId,
      [IMANI_KEY]: IMANI.nationalId,
      [BARAKA_KEY]: null,
    });
    expect(householdIds(document, null).officer).toBeNull();
  });
});

describe('registryRows: the Registry tab pairs records with declared items (S12)', () => {
  const input = () =>
    wanjiku((h) => {
      h.officer.assets.push(land('NAKURU/NJORO/1187'));
    });

  it('land: a registry parcel beside the declared item, undeclared, or a declared number not found', () => {
    const { document } = input();
    const officer = document.statements[0];
    const kiambu = officer?.assets.find((a) => a.details?.parcelNumber?.startsWith('KIAMBU'));
    const nakuru = officer?.assets.find((a) => a.details?.parcelNumber?.startsWith('NAKURU'));

    const rows = registryRows(document, 'officer', 'ardhisasa', WANJIKU.results().ardhisasa);

    expect(
      rows.map((row) => [row.registryRecord.parcelNumber, row.relation, row.declaredItemId]),
    ).toEqual([
      ['KIAMBU/RUIRU EAST BLOCK 2/4417', 'matched', kiambu?.id],
      ['KAJIADO/KITENGELA/59821', 'not-declared', null],
      ['NAKURU/NJORO/1187', 'not-in-registry', nakuru?.id],
    ]);
    // The registry's record as the gateway holds it; a declared number alone when not found.
    expect(rows[1]?.registryRecord).toEqual({
      parcelNumber: 'KAJIADO/KITENGELA/59821',
      county: 'Kajiado',
      areaHectares: 2.0235,
      tenure: 'freehold',
      registeredOn: '2025-01-17',
    });
    expect(rows[2]?.registryRecord).toEqual({ parcelNumber: 'NAKURU/NJORO/1187' });
  });

  it('vehicles by registration: the Fielder declared, the Prado not', () => {
    const { document } = input();
    const fielder = document.statements[0]?.assets.find((a) => a.type === 'vehicle');

    const rows = registryRows(document, 'officer', 'ntsa', WANJIKU.results().ntsa);

    expect(
      rows.map((row) => [row.registryRecord.registrationNumber, row.relation, row.declaredItemId]),
    ).toEqual([
      ['KCX 214J', 'matched', fielder?.id],
      ['KDK 482M', 'not-declared', null],
    ]);
  });

  it("companies: the officer's paragraph 9 directorship and the spouse's shares, by name", () => {
    const { document } = input();
    const spouseShares = document.statements[1]?.assets.find((a) => a.type === 'shareholding');

    expect(
      registryRows(document, 'officer', 'brs', WANJIKU.results().brs).map((row) => [
        row.registryRecord.companyRegistrationNumber,
        row.relation,
        row.declaredItemId,
      ]),
    ).toEqual([['PVT-9XYZ2L4Q', 'matched', null]]);
    expect(
      registryRows(document, SPOUSE, 'brs', PETER.results().brs).map((row) => [
        row.relation,
        row.declaredItemId,
      ]),
    ).toEqual([['matched', spouseShares?.id]]);
  });

  it('KRA: PIN presence, compliance and the income difference as a percentage, never an amount', () => {
    const { document } = input();
    const kiprono = declaration([officerStatement()]);

    expect(registryRows(document, 'officer', 'kra', WANJIKU.results().kra)).toEqual([
      {
        registryRecord: {
          pinPresent: true,
          complianceStatus: 'compliant',
          validUntil: '2027-06-30',
          incomeDifferencePercent: 0,
          incomeDirection: 'below',
        },
        declaredItemId: null,
        relation: 'matched',
      },
    ]);
    const [row] = registryRows(kiprono, 'officer', 'kra', KIPRONO.results().kra);
    expect(row?.registryRecord).toMatchObject({
      complianceStatus: 'non-compliant',
      validUntil: null,
    });
    expect(JSON.stringify(row)).not.toContain('2640000');
    expect(registryRows(document, 'officer', 'kra', kraResult([]))).toEqual([]);
  });

  it('no rows for a person the declaration does not have', () => {
    expect(registryRows(input().document, 'spouse:unknown', 'ntsa', PETER.results().ntsa)).toEqual(
      [],
    );
  });
});
