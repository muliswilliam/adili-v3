import { describe, expect, it } from 'vitest';

import {
  caseData,
  caseItem,
  CHECKED_AT,
  DISSOLVED_FLAG,
  DOCUMENT,
  flag,
  ME,
  PLOT,
  registryView,
  SUPPLIER_FLAG,
  SUPPLIER_NOT_RUN_FLAG,
  VEHICLE_FLAG,
  WAFULA,
} from './fixtures';
import {
  cooldownMinutes,
  kraLines,
  matchRows,
  recheckAccess,
  recheckLanded,
  type RegistryRow,
  registryLayout,
  registryNeedsAttention,
  roleWords,
  statusDescription,
  summaryView,
} from './registry';

const reviewed = {
  at: '2026-10-02T08:00:00Z',
  by: { subject: ME.subject, name: ME.name },
  note: 'Bought in 2024; the officer will amend.',
};

describe('statusDescription', () => {
  it('says what each status means, with counts', () => {
    expect(statusDescription('ntsa', 'matched', { records: 2, indicators: 0 })).toBe(
      '2 records, all declared',
    );
    expect(statusDescription('ntsa', 'matched', { records: 1, indicators: 0 })).toBe(
      '1 record, all declared',
    );
    expect(statusDescription('ntsa', 'matched', { records: 0, indicators: 0 })).toBe(
      'No records found',
    );
    // Statuses of the last check only: the records were not read.
    expect(statusDescription('ntsa', 'matched', { records: null, indicators: 0 })).toBe(
      'All records declared',
    );
    expect(statusDescription('kra', 'matched', { records: 1, indicators: 0 })).toBe(
      'PIN on record, compliant, income within 25%',
    );
    expect(
      statusDescription('kra', 'matched', { records: 1, indicators: 0, incomeCompared: false }),
    ).toBe('PIN on record, compliant');
    expect(statusDescription('brs', 'mismatched', { records: 1, indicators: 2 })).toBe(
      '2 indicators',
    );
    expect(statusDescription('brs', 'mismatched', { records: 1, indicators: 1 })).toBe(
      '1 indicator',
    );
    expect(statusDescription('ardhisasa', 'unavailable', { records: null, indicators: 0 })).toBe(
      'Could not reach ArdhiSasa. Re-checked automatically every hour.',
    );
    expect(statusDescription('kra', 'not-checked', { records: null, indicators: 0 })).toBe(
      'Checks run after submission.',
    );
    expect(
      statusDescription('ntsa', 'no-id', { records: null, indicators: 0, personName: 'Imani' }),
    ).toBe('Registries cannot be checked for Imani without an ID.');
  });

  it('S6: names open notes after the status, and never reads "all declared" beside them', () => {
    const notRun = { supplierCheckNotRun: true, others: 0 };
    expect(statusDescription('brs', 'matched', { records: 1, indicators: 0, notes: notRun })).toBe(
      '1 record, supplier check not run',
    );
    expect(
      statusDescription('brs', 'matched', {
        records: 2,
        indicators: 0,
        notes: { supplierCheckNotRun: true, others: 1 },
      }),
    ).toBe('2 records, supplier check not run, 1 note');
    expect(
      statusDescription('brs', 'matched', { records: null, indicators: 0, notes: notRun }),
    ).toBe('No indicators, supplier check not run');
    expect(
      statusDescription('ardhisasa', 'matched', {
        records: 0,
        indicators: 0,
        notes: { supplierCheckNotRun: false, others: 2 },
      }),
    ).toBe('No records found, 2 notes');
    expect(
      statusDescription('brs', 'mismatched', {
        records: 1,
        indicators: 1,
        notes: { supplierCheckNotRun: false, others: 1 },
      }),
    ).toBe('1 indicator, 1 note');
  });
});

describe('registryLayout', () => {
  it('lists the declarant first with a row per registry, and no rows for someone without an ID', () => {
    const layout = registryLayout(registryView(), [], true);

    expect(layout.checkedAt).toBe(CHECKED_AT);
    expect(layout.noIds).toBe(false);
    expect(layout.persons.map((person) => [person.name, person.kind])).toEqual([
      ['Wanjiku Njoki Kamau', 'declarant'],
      ['Imani Wairimu Kamau', 'child'],
    ]);
    const [wanjiku, imani] = layout.persons;
    expect(wanjiku?.systems.map((row) => [row.name, row.status, row.description])).toEqual([
      ['KRA', 'matched', 'PIN on record, compliant, income within 25%'],
      ['NTSA', 'mismatched', '1 indicator'],
      ['BRS', 'mismatched', '1 indicator'],
      [
        'ArdhiSasa',
        'unavailable',
        'Could not reach ArdhiSasa. Re-checked automatically every hour.',
      ],
    ]);
    expect(imani?.hasNationalId).toBe(false);
    expect(imani?.systems).toEqual([]);
  });

  it('opens a registry that answered, once its records are read', () => {
    const loaded = registryLayout(registryView(), [], true).persons[0]?.systems;
    expect(loaded?.map((row) => row.expandable)).toEqual([true, true, true, false]);

    const statusesOnly = registryLayout(registryView(), [], false).persons[0]?.systems;
    expect(statusesOnly?.map((row) => row.expandable)).toEqual([false, false, false, false]);
  });

  it('dates a registry only when it was checked apart from the rest', () => {
    const view = registryView();
    const ardhisasa = view.persons[0]?.systems[3];
    if (ardhisasa) ardhisasa.checkedAt = '2026-10-02T08:30:00.000Z';

    const rows = registryLayout(view, [], true).persons[0]?.systems;
    expect(rows?.map((row) => row.checkedAt)).toEqual([
      null,
      null,
      null,
      '2026-10-02T08:30:00.000Z',
    ]);
  });

  it("shows the case's own copy of a flag reviewed since the view was read, open flags first", () => {
    const view = registryView();
    const ntsa = view.persons[0]?.systems[1];
    const closed = flag({
      id: '0192f1a0-0000-7000-8000-0000000f0199',
      ruleId: 'declared-vehicle-not-found',
      closedReason: 'superseded-by-recheck',
    });
    if (ntsa) ntsa.flags = [closed, VEHICLE_FLAG];

    const latest = [{ ...VEHICLE_FLAG, reviewed }];
    const row = registryLayout(view, latest, true).persons[0]?.systems[1];
    expect(row?.flags.map((each) => [each.id, each.reviewed !== null])).toEqual([
      [VEHICLE_FLAG.id, true],
      [closed.id, false],
    ]);
    // A flag a re-check closed is no indicator any more.
    expect(row?.description).toBe('1 indicator');
  });

  it('says nobody can be checked when no one has a national ID', () => {
    const view = registryView();
    view.persons = view.persons.filter((person) => !person.hasNationalId);

    expect(registryLayout(view, [], true).noIds).toBe(true);
  });
});

describe('registryLayout: notes', () => {
  it('S6: counts info flags as notes on the collapsed row, not as indicators', () => {
    const view = registryView();
    const [officer] = view.persons;
    const brs = officer?.systems.find((entry) => entry.system === 'brs');
    if (!brs) throw new Error('no BRS row');
    brs.status = 'matched';
    brs.flags = [
      SUPPLIER_NOT_RUN_FLAG,
      DISSOLVED_FLAG,
      { ...DISSOLVED_FLAG, id: 'x', closedReason: 'superseded-by-recheck' },
    ];

    for (const loaded of [true, false]) {
      const row = registryLayout(view, [], loaded).persons[0]?.systems.find(
        (each) => each.system === 'brs',
      );
      expect(row?.description).toBe(
        loaded
          ? '1 record, supplier check not run, 1 note'
          : 'No indicators, supplier check not run, 1 note',
      );
    }
  });
});

describe('summaryView', () => {
  it("rebuilds the statuses from the case's last check when the records cannot be read", () => {
    const summary = {
      checkedAt: CHECKED_AT,
      checks: [
        {
          personKey: 'officer',
          system: 'ntsa' as const,
          status: 'mismatched' as const,
          reason: null,
          checkedAt: CHECKED_AT,
          resultId: '0192f1a0-0000-7000-8000-0000000c0002',
        },
        {
          personKey: 'officer',
          system: 'ardhisasa' as const,
          status: 'unavailable' as const,
          reason: 'paused',
          checkedAt: CHECKED_AT,
          resultId: null,
        },
      ],
    };

    const view = summaryView(summary, DOCUMENT, [VEHICLE_FLAG, SUPPLIER_FLAG], 'Wanjiku Kamau');
    const layout = registryLayout(view, [], false);

    expect(layout.persons.map((person) => person.name)).toEqual(['Wanjiku Njoki Kamau']);
    expect(layout.persons[0]?.systems.map((row) => [row.system, row.status])).toEqual([
      ['kra', 'not-checked'],
      ['ntsa', 'mismatched'],
      ['brs', 'not-checked'],
      ['ardhisasa', 'unavailable'],
    ]);
    expect(layout.persons[0]?.systems[1]?.flags.map((each) => each.id)).toEqual([VEHICLE_FLAG.id]);
    expect(layout.persons[0]?.systems[2]?.flags.map((each) => each.id)).toEqual([SUPPLIER_FLAG.id]);
  });

  it('names the declarant from the case when the declaration could not be read either', () => {
    const view = summaryView({ checkedAt: null, checks: [] }, null, [], 'Wanjiku Kamau');

    expect(view.persons.map((person) => [person.personName, person.hasNationalId])).toEqual([
      ['Wanjiku Kamau', true],
    ]);
  });
});

describe('registryNeedsAttention', () => {
  it('marks the tab when a registry could not be checked', () => {
    const check = {
      personKey: 'officer',
      system: 'ntsa' as const,
      reason: null,
      checkedAt: CHECKED_AT,
      resultId: null,
    };
    expect(registryNeedsAttention(caseData())).toBe(false);
    expect(
      registryNeedsAttention(
        caseData({
          registry: { checkedAt: CHECKED_AT, checks: [{ ...check, status: 'unavailable' }] },
        }),
      ),
    ).toBe(true);
    expect(
      registryNeedsAttention(
        caseData({
          registry: { checkedAt: CHECKED_AT, checks: [{ ...check, status: 'matched' }] },
        }),
      ),
    ).toBe(false);
  });
});

describe('matchRows', () => {
  const parcel = (
    relation: RegistryRow['relation'],
    declaredItemId: string | null,
  ): RegistryRow => ({
    registryRecord:
      relation === 'not-in-registry'
        ? { parcelNumber: 'KAJIADO/KITENGELA/11111' }
        : {
            parcelNumber: 'KAJIADO/KITENGELA/59821',
            county: 'Kajiado',
            areaHectares: 2.0235,
            tenure: 'freehold',
            registeredOn: '2025-01-17',
          },
    declaredItemId,
    relation,
  });

  it('puts each parcel beside the declared item it matched', () => {
    const [row] = matchRows('ardhisasa', [parcel('matched', PLOT)], DOCUMENT, []);

    expect(row).toMatchObject({
      record: 'KAJIADO/KITENGELA/59821',
      recordDetail: 'Kajiado · 2.0235 ha · freehold · registered 17 Jan 2025',
      relation: 'matched',
      declared: 'Land',
      declaredDetail: 'Agricultural parcel in Kitengela',
      itemId: PLOT,
      supplier: false,
    });
  });

  it('marks a record not declared, and a declared identifier the registry does not know', () => {
    const rows = matchRows(
      'ardhisasa',
      [parcel('not-declared', null), parcel('not-in-registry', PLOT)],
      DOCUMENT,
      [],
    );

    expect(rows.map((row) => [row.record, row.relation, row.declared, row.itemId])).toEqual([
      ['KAJIADO/KITENGELA/59821', 'not-declared', null, null],
      ['KAJIADO/KITENGELA/11111', 'not-in-registry', 'Land', PLOT],
    ]);
    expect(rows[1]?.recordDetail).toBe('ArdhiSasa has no parcel with this number');
  });

  it('describes a vehicle by make, model, year and registration date', () => {
    const view = registryView();
    const [row] = matchRows('ntsa', view.persons[0]?.systems[1]?.rows ?? [], DOCUMENT, []);

    expect(row).toMatchObject({
      record: 'KDK 482M',
      recordDetail: 'Toyota Land Cruiser Prado · 2023 · registered 4 Nov 2024',
      relation: 'not-declared',
    });
  });

  it("names a company and its role, and marks one on the employer's supplier list", () => {
    const view = registryView();
    const rows = view.persons[0]?.systems[2]?.rows ?? [];

    const [row] = matchRows('brs', rows, DOCUMENT, [SUPPLIER_FLAG]);
    expect(row).toMatchObject({
      record: 'Afya Bora Medical Supplies Limited',
      recordDetail: 'PVT-9XYZ2L4Q · Director and shareholder, 400 shares · appointed 14 Feb 2022',
      supplier: true,
    });
    expect(matchRows('brs', rows, DOCUMENT, [])[0]?.supplier).toBe(false);
  });

  it('says when a company is no longer trading', () => {
    const [row] = matchRows(
      'brs',
      [
        {
          registryRecord: {
            companyRegistrationNumber: 'PVT-3KLM8R2T',
            companyName: 'Rift Valley Agrovet Limited',
            companyStatus: 'dissolved',
            role: 'shareholder',
            shares: null,
            appointedOn: '2015-08-03',
          },
          declaredItemId: null,
          relation: 'matched',
        },
      ],
      DOCUMENT,
      [],
    );
    expect(row?.recordDetail).toBe('PVT-3KLM8R2T · Shareholder · Dissolved · appointed 3 Aug 2015');
  });
});

describe('kraLines', () => {
  const kra = (record: Record<string, string | number | boolean | null>): RegistryRow => ({
    registryRecord: record,
    declaredItemId: null,
    relation: 'matched',
  });

  it('shows the PIN, compliance with its certificate, and the income difference as a percentage', () => {
    const lines = kraLines([
      kra({
        pinPresent: true,
        complianceStatus: 'compliant',
        validUntil: '2027-06-30',
        incomeDifferencePercent: 12,
        incomeDirection: 'above',
      }),
    ]);

    expect(lines).toEqual([
      {
        id: 'pin',
        label: 'PIN',
        badge: { text: 'On record', tone: 'success' },
        text: null,
        warning: false,
      },
      {
        id: 'compliance',
        label: 'Tax compliance',
        badge: { text: 'Compliant', tone: 'success' },
        text: 'Certificate valid until 30 Jun 2027',
        warning: false,
      },
      {
        id: 'income',
        label: 'Income declared to KRA',
        badge: null,
        text: 'KRA-declared income differs by 12% from the income declared here.',
        warning: false,
      },
    ]);
  });

  it('warns when not compliant or the income is 25% or more apart', () => {
    const lines = kraLines([
      kra({
        pinPresent: true,
        complianceStatus: 'non-compliant',
        validUntil: null,
        incomeDifferencePercent: 40,
        incomeDirection: 'below',
      }),
    ]);

    expect(lines[1]).toMatchObject({
      badge: { text: 'Not compliant', tone: 'warning' },
      text: 'No valid compliance certificate',
      warning: true,
    });
    expect(lines[2]).toMatchObject({
      text: 'KRA-declared income differs by 40% from the income declared here.',
      warning: true,
    });
  });

  it('says when there is no PIN for the ID, and when income could not be compared', () => {
    expect(kraLines([])).toEqual([
      {
        id: 'pin',
        label: 'PIN',
        badge: { text: 'No PIN for this ID', tone: 'warning' },
        text: null,
        warning: true,
      },
    ]);
    const lines = kraLines([
      kra({ pinPresent: true, complianceStatus: 'unknown', incomeDifferencePercent: null }),
      kra({ pinPresent: true, complianceStatus: 'compliant', incomeDifferencePercent: null }),
    ]);
    expect(lines[0]?.badge?.text).toBe('2 PINs on record');
    expect(lines[1]?.badge).toEqual({ text: 'Unknown', tone: 'default' });
    expect(lines[2]?.text).toBe('Income declared to KRA could not be compared.');
  });
});

describe('re-check', () => {
  const reviewer = { subject: ME.subject, supervisor: false };

  it('is for the assignee or a supervisor; another reviewer sees it disabled', () => {
    expect(recheckAccess(caseItem({ assignee: ME, status: 'assigned' }), reviewer)).toBe('allowed');
    expect(recheckAccess(caseItem({ assignee: WAFULA, status: 'assigned' }), reviewer)).toBe(
      'forbidden',
    );
    expect(recheckAccess(caseItem({ assignee: null }), reviewer)).toBe('forbidden');
    expect(
      recheckAccess(caseItem({ assignee: WAFULA, status: 'assigned' }), {
        ...reviewer,
        supervisor: true,
      }),
    ).toBe('allowed');
    expect(recheckAccess(caseItem({ assignee: ME, status: 'determined' }), reviewer)).toBe(
      'hidden',
    );
  });

  it('rounds the cooldown up to whole minutes', () => {
    expect(cooldownMinutes(1)).toBe(1);
    expect(cooldownMinutes(60)).toBe(1);
    expect(cooldownMinutes(61)).toBe(2);
    expect(cooldownMinutes(599)).toBe(10);
  });

  it('knows the re-check landed once the latest check changed', () => {
    expect(recheckLanded(CHECKED_AT, CHECKED_AT)).toBe(false);
    expect(recheckLanded(CHECKED_AT, null)).toBe(false);
    expect(recheckLanded(CHECKED_AT, '2026-10-02T08:00:00.000Z')).toBe(true);
    expect(recheckLanded(null, CHECKED_AT)).toBe(true);
  });
});

describe('roleWords', () => {
  it('turns BRS roles into words', () => {
    expect(roleWords('director_shareholder')).toBe('Director and shareholder');
    expect(roleWords('director')).toBe('Director');
    expect(roleWords('SHAREHOLDER')).toBe('Shareholder');
  });
});
