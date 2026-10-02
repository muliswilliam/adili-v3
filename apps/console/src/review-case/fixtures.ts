import type { DeclarationV1 } from '@adili/forms';

import type { CaseFlag, CaseRegistryView, CaseViewDetail } from '../server/review-case.server';
import type { CaseListItem } from '../server/review/types';

/** A review case for tests of the case view: Wanjiku Kamau's declaration, three flags. */

export const ME = { subject: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Achieng Njeri' };
export const WAFULA = { subject: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Wafula Barasa' };
export const CASE_ID = '01a0fb83-c3d0-7610-9613-f034d433ffd3';
export const SALARY = '0192f1a0-5a11-7000-8000-00000000a101';
export const PLOT = '0192f1a0-5a11-7000-8000-00000000a201';

const period = { from: '2025-11-01', to: '2026-06-01' };

export const DOCUMENT: DeclarationV1 = {
  schemaVersion: 'declaration.v1',
  type: 'initial',
  statementDate: '2026-06-01',
  incomePeriod: { ...period, fromSource: 'declared' },
  officer: {
    name: { surname: 'Kamau', firstName: 'Wanjiku', otherNames: 'Njoki' },
    birth: { date: '1984-05-14', place: 'Nyeri' },
    maritalStatus: 'single',
    address: { postal: 'P.O. Box 47715-00100, Nairobi', physical: 'Embakasi, Nairobi' },
    employment: {
      designation: 'Deputy Director, Procurement',
      employer: 'Kenya Medical Supplies Authority',
      nature: 'permanent',
      responsibleCommission: 'psc',
    },
  },
  spouses: { none: true, items: [] },
  children: { none: true, items: [] },
  statements: [
    {
      personKey: 'officer',
      personName: { surname: 'Kamau', firstName: 'Wanjiku', otherNames: 'Njoki' },
      statementDate: '2026-06-01',
      incomePeriod: period,
      incomeNil: false,
      income: [
        {
          id: SALARY,
          type: 'salary-emoluments',
          description: 'Salary from KEMSA',
          amount: { kesCents: 210_000_000 },
          location: { inKenya: true, county: '047' },
          change: { changed: false },
        },
      ],
      assetsNil: false,
      assets: [
        {
          id: PLOT,
          type: 'land',
          description: 'Agricultural parcel in Kitengela',
          value: { kesCents: 600_000_000 },
          location: { inKenya: true, county: '034' },
          joint: { isJoint: false },
          change: { changed: false },
        },
      ],
      liabilitiesNil: true,
      liabilities: [],
    },
  ],
  otherInformation: {
    materialChanges: [],
    registrableInterests: {
      directorships: [],
      memberships: [],
      dualCitizenship: { holds: false, pendingApplication: false },
      pendingCases: [],
    },
    freeText: '',
  },
  attestation: {
    text: 'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.',
    declaredAt: '2026-09-21T13:05:00Z',
  },
};

export function flag(overrides: Partial<CaseFlag> = {}): CaseFlag {
  return {
    id: '0192f1a0-0000-7000-8000-0000000f0001',
    versionId: 'e2e16400-0000-4000-8000-00000000b003',
    ruleId: 'value-change-25',
    severity: 'medium',
    title: 'Value changed by 25% or more',
    indicator: 'The value of this item moved by at least a quarter since the previous declaration.',
    evidence: { changePercent: 42, direction: 'down' },
    itemRefs: [{ personKey: 'officer', itemId: SALARY, sectionKey: null }],
    closedReason: null,
    reviewed: null,
    recomputed: false,
    ...overrides,
  };
}

export function caseItem(overrides: Partial<CaseListItem> = {}): CaseListItem {
  return {
    id: CASE_ID,
    reference: 'DCI-PSC-2026-9164002-3',
    declarantName: 'Wanjiku Kamau',
    personnelFileNumber: 'KEMSA/2011/0457',
    type: 'initial',
    cycleYear: 2026,
    receivedAt: '2026-09-21T13:05:00Z',
    windowEndsAt: '2027-03-21T13:05:00Z',
    late: true,
    band: 'high',
    status: 'unassigned',
    assignee: null,
    openFlags: 3,
    registryUnavailable: false,
    clarification: { open: 0, status: null, dueAt: null },
    currentVersion: 1,
    ...overrides,
  };
}

/** The case detail without its document (`DOCUMENT` is the declaration as filed). */
export type CaseData = Omit<CaseViewDetail, 'document'>;

export function caseData(overrides: Partial<CaseData> = {}): CaseData {
  return {
    case: caseItem(),
    flags: [
      flag(),
      flag({
        id: '0192f1a0-0000-7000-8000-0000000f0002',
        ruleId: 'income-vs-asset-growth',
        severity: 'high',
        title: 'Assets grew faster than declared income',
        evidence: { growthToIncome: 4.8 },
        itemRefs: [],
      }),
      flag({
        id: '0192f1a0-0000-7000-8000-0000000f0003',
        ruleId: 'acquisition-unflagged',
        severity: 'medium',
        title: 'New item not marked as new',
        evidence: { category: 'assets' },
        itemRefs: [{ personKey: 'officer', itemId: PLOT, sectionKey: null }],
      }),
    ],
    clarifications: [],
    notes: [],
    timeline: [
      {
        id: '0192f1a0-0000-7000-8000-0000000e0001',
        kind: 'case-created',
        actor: null,
        at: '2026-10-02T07:28:00Z',
        summary: 'Case created from version 1 with 3 flags',
        ref: null,
      },
    ],
    versions: [
      {
        versionId: 'e2e16400-0000-4000-8000-00000000b003',
        amendment: false,
        version: 1,
        submittedAt: '2026-09-21T13:05:00Z',
        late: true,
        firstOnAdili: true,
      },
    ],
    reviewerHistory: [],
    registry: { checkedAt: null, checks: [], recheckAvailableAt: null },
    ...overrides,
  };
}

export const CHECKED_AT = '2026-10-02T07:30:00.000Z';

/** Wanjiku's undeclared Prado (NTSA), as review raises it. */
export const VEHICLE_FLAG = flag({
  id: '0192f1a0-0000-7000-8000-0000000f0101',
  ruleId: 'registry-vehicle-undeclared',
  severity: 'medium',
  title: 'Vehicle in the registry not declared',
  indicator: "NTSA lists a vehicle in this person's name that the declaration does not.",
  evidence: { registrationNumber: 'KDK 482M' },
  itemRefs: [{ personKey: 'officer', itemId: null, sectionKey: 'statement:officer' }],
});

/** Wanjiku's directorship in a KEMSA supplier (BRS). */
export const SUPPLIER_FLAG = flag({
  id: '0192f1a0-0000-7000-8000-0000000f0102',
  ruleId: 'directorship-employer-supplier',
  severity: 'high',
  title: 'Director of a company that supplies the employer',
  indicator: "BRS lists a role in a company on the employer's supplier list.",
  evidence: { companyRegistrationNumber: 'PVT-9XYZ2L4Q', role: 'director_shareholder' },
  itemRefs: [{ personKey: 'officer', itemId: null, sectionKey: 'statement:officer' }],
});

/** BRS could not compare Wanjiku's companies with a supplier list: her roster names no employer. */
export const SUPPLIER_NOT_RUN_FLAG = flag({
  id: '0192f1a0-0000-7000-8000-0000000f0103',
  ruleId: 'registry-supplier-check-not-run',
  severity: 'info',
  title: "Companies not compared with the employer's suppliers",
  indicator:
    "The declarant's roster record names no employer, so the companies BRS lists for them could not be compared with an employer's supplier list.",
  evidence: { companies: 1 },
  itemRefs: [{ personKey: 'officer', itemId: null, sectionKey: 'statement:officer' }],
});

/** A company Wanjiku declared that BRS lists as dissolved. */
export const DISSOLVED_FLAG = flag({
  id: '0192f1a0-0000-7000-8000-0000000f0104',
  ruleId: 'registry-company-dissolved',
  severity: 'info',
  title: 'Declared company dissolved at BRS',
  indicator:
    'BRS lists this declared company as dissolved. A holding declared before the dissolution was registered can explain this.',
  evidence: { companyRegistrationNumber: 'PVT-3KLM8R2T' },
  itemRefs: [{ personKey: 'officer', itemId: null, sectionKey: 'statement:officer' }],
});

type RegistrySystemEntry = CaseRegistryView['persons'][number]['systems'][number];

export function registrySystem(overrides: Partial<RegistrySystemEntry>): RegistrySystemEntry {
  return {
    system: 'kra',
    status: 'matched',
    reason: null,
    checkedAt: CHECKED_AT,
    resultId: '0192f1a0-0000-7000-8000-0000000c0001',
    rows: [],
    flags: [],
    ...overrides,
  };
}

/**
 * The Registry tab of Wanjiku's case: KRA matched, NTSA mismatched (the Prado), BRS mismatched
 * (the supplier), ArdhiSasa unavailable (paused); a child declared without a national ID.
 */
export function registryView(): CaseRegistryView {
  return {
    checkedAt: CHECKED_AT,
    persons: [
      {
        personKey: 'officer',
        personName: 'Wanjiku Njoki Kamau',
        hasNationalId: true,
        systems: [
          registrySystem({
            rows: [
              {
                registryRecord: {
                  pinPresent: true,
                  complianceStatus: 'compliant',
                  validUntil: '2027-06-30',
                  incomeDifferencePercent: 12,
                  incomeDirection: 'above',
                },
                declaredItemId: null,
                relation: 'matched',
              },
            ],
          }),
          registrySystem({
            system: 'ntsa',
            status: 'mismatched',
            rows: [
              {
                registryRecord: {
                  registrationNumber: 'KDK 482M',
                  make: 'Toyota',
                  model: 'Land Cruiser Prado',
                  yearOfManufacture: 2023,
                  registeredOn: '2024-11-04',
                },
                declaredItemId: null,
                relation: 'not-declared',
              },
            ],
            flags: [VEHICLE_FLAG],
          }),
          registrySystem({
            system: 'brs',
            status: 'mismatched',
            rows: [
              {
                registryRecord: {
                  companyRegistrationNumber: 'PVT-9XYZ2L4Q',
                  companyName: 'Afya Bora Medical Supplies Limited',
                  companyStatus: 'active',
                  role: 'director_shareholder',
                  shares: 400,
                  appointedOn: '2022-02-14',
                },
                declaredItemId: null,
                relation: 'not-declared',
              },
            ],
            flags: [SUPPLIER_FLAG],
          }),
          registrySystem({
            system: 'ardhisasa',
            status: 'unavailable',
            reason: 'paused',
            resultId: null,
          }),
        ],
      },
      {
        personKey: 'child:6a1f0000-0000-4000-8000-000000000001',
        personName: 'Imani Wairimu Kamau',
        hasNationalId: false,
        systems: (['kra', 'ntsa', 'brs', 'ardhisasa'] as const).map((system) =>
          registrySystem({ system, status: 'no-id', resultId: null }),
        ),
      },
    ],
  };
}
