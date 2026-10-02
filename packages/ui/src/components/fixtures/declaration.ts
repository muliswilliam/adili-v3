import type { DeclarationV1 } from '@adili/forms';

/**
 * A biennial declaration as filed, for the stories and tests of `DeclarationSummary`: Wanjiku
 * Njeri Kamau, her spouse and two children, the prototype's household (07a-review).
 */

const SPOUSE = '0192f1a0-5a11-7000-8000-00000000d101';
const AMANI = '0192f1a0-5a11-7000-8000-00000000d201';
const BARAKA = '0192f1a0-5a11-7000-8000-00000000d202';

export const BUILDING_ID = '0192f1a0-5a11-7000-8000-00000000a201';
export const VEHICLE_ID = '0192f1a0-5a11-7000-8000-00000000a203';
export const SPOUSE_KEY = `spouse:${SPOUSE}`;

const period = { from: '2023-11-01', to: '2025-11-01' };
const nairobi = { inKenya: true, county: '047' } as const;

export const WANJIKU_DECLARATION: DeclarationV1 = {
  schemaVersion: 'declaration.v1',
  type: 'biennial',
  statementDate: '2025-11-01',
  incomePeriod: { ...period, fromSource: 'declared' },
  officer: {
    name: { surname: 'Kamau', firstName: 'Wanjiku', otherNames: 'Njeri' },
    birth: { date: '1981-03-14', place: 'Nyeri' },
    maritalStatus: 'married',
    address: {
      postal: 'P.O. Box 30016-00100, Nairobi',
      physical: 'Syokimau, Machakos County',
    },
    employment: {
      designation: 'Senior Procurement Officer',
      employer: 'Kenya Medical Supplies Authority',
      nature: 'permanent',
      responsibleCommission: 'psc',
      personnelFileNumber: '2009-004417',
      jobGroup: 'P',
    },
  },
  spouses: {
    none: false,
    items: [
      {
        id: SPOUSE,
        name: { surname: 'Kamau', firstName: 'David' },
        nationalId: '22914408',
        occupationSector: 'private',
        separated: false,
      },
    ],
  },
  children: {
    none: false,
    items: [
      {
        id: AMANI,
        name: { surname: 'Kamau', firstName: 'Amani' },
        dateOfBirth: '2012-05-09',
        includedAtStatementDate: true,
      },
      {
        id: BARAKA,
        name: { surname: 'Kamau', firstName: 'Baraka' },
        dateOfBirth: '2016-08-21',
        includedAtStatementDate: true,
      },
    ],
  },
  statements: [
    {
      personKey: 'officer',
      personName: { surname: 'Kamau', firstName: 'Wanjiku', otherNames: 'Njeri' },
      statementDate: '2025-11-01',
      incomePeriod: period,
      incomeNil: false,
      income: [
        {
          id: '0192f1a0-5a11-7000-8000-00000000a101',
          type: 'salary-emoluments',
          description: 'KEMSA, job group P',
          amount: { kesCents: 468_000_000 },
          location: nairobi,
          change: { changed: false },
        },
        {
          id: '0192f1a0-5a11-7000-8000-00000000a102',
          type: 'rent',
          description: '4-bedroom house, Syokimau',
          amount: { kesCents: 72_000_000 },
          location: { inKenya: true, county: '016', detail: 'Syokimau' },
          change: { changed: false },
        },
      ],
      assetsNil: false,
      assets: [
        {
          id: BUILDING_ID,
          type: 'building',
          description: '4-bedroom house on LR 12715/482',
          details: { parcelNumber: 'LR 12715/482' },
          value: { kesCents: 1_690_000_000 },
          location: { inKenya: true, county: '016', detail: 'Syokimau' },
          joint: { isJoint: false },
          change: { changed: false },
          attachments: [
            {
              attachmentId: '0192f1a0-5a11-7000-8000-00000000f101',
              uploadId: '0192f1a0-5a11-7000-8000-00000000e101',
              fileName: 'Title deed LR 12715-482.pdf',
              sha256: 'a'.repeat(64),
            },
            {
              attachmentId: '0192f1a0-5a11-7000-8000-00000000f102',
              uploadId: '0192f1a0-5a11-7000-8000-00000000e102',
              fileName: 'Valuation report Syokimau 2025.pdf',
              sha256: 'b'.repeat(64),
            },
          ],
        },
        {
          id: '0192f1a0-5a11-7000-8000-00000000a202',
          type: 'land',
          description: '0.5 acre plot',
          details: { parcelNumber: 'NYERI/MUKURWE-INI/1187', size: '0.5 acre' },
          value: { kesCents: 240_000_000 },
          location: { inKenya: true, county: '019' },
          joint: { isJoint: false },
          change: { changed: false },
        },
        {
          id: VEHICLE_ID,
          type: 'vehicle',
          description: 'Toyota Prado, KDH 120J',
          details: { registration: 'KDH 120J', makeModel: 'Toyota Land Cruiser Prado' },
          value: { kesCents: 520_000_000 },
          location: nairobi,
          joint: { isJoint: false },
          change: {
            changed: true,
            kind: 'value-change',
            explanation: 'Valued lower after two years of use.',
          },
        },
        {
          id: '0192f1a0-5a11-7000-8000-00000000a204',
          type: 'bank-account',
          description: 'Stanbic Bank Uganda account',
          details: { institution: 'Stanbic Bank Uganda', accountType: 'Savings' },
          value: { kesCents: 41_000_000, original: { currency: 'UGX', minorUnits: 1_180_000_000 } },
          location: { inKenya: false, country: 'UG', detail: 'Kampala' },
          joint: { isJoint: true, sharePercent: 50, coOwner: 'David Kamau' },
          change: { changed: false },
        },
      ],
      liabilitiesNil: false,
      liabilities: [
        {
          id: '0192f1a0-5a11-7000-8000-00000000a301',
          type: 'mortgage',
          description: 'Mortgage on the Syokimau house',
          creditor: 'KCB Bank',
          outstanding: { kesCents: 678_000_000 },
          location: nairobi,
          change: { changed: false },
        },
      ],
    },
    {
      personKey: SPOUSE_KEY,
      personName: { surname: 'Kamau', firstName: 'David' },
      statementDate: '2025-11-01',
      incomePeriod: period,
      incomeNil: false,
      income: [
        {
          id: '0192f1a0-5a11-7000-8000-00000000b101',
          type: 'business',
          description: 'Hardware shop, Kitengela',
          amount: { kesCents: 190_000_000 },
          location: { inKenya: true, county: '034', detail: 'Kitengela' },
          change: { changed: false },
        },
      ],
      assetsNil: false,
      assets: [
        {
          id: '0192f1a0-5a11-7000-8000-00000000b201',
          type: 'shareholding',
          description: 'Shares in Kitengela Hardware Ltd',
          details: { quantityOrPercent: '60%' },
          value: { kesCents: 430_000_000 },
          location: { inKenya: true, county: '034' },
          joint: { isJoint: false },
          change: { changed: false },
        },
      ],
      liabilitiesNil: false,
      liabilities: [
        {
          id: '0192f1a0-5a11-7000-8000-00000000b301',
          type: 'loan',
          description: 'Stock financing',
          creditor: 'Equity Bank Kenya',
          outstanding: { kesCents: 90_000_000 },
          location: { inKenya: true, county: '034' },
          change: { changed: false },
        },
      ],
    },
    {
      personKey: `child:${AMANI}`,
      personName: { surname: 'Kamau', firstName: 'Amani' },
      statementDate: '2025-11-01',
      incomePeriod: period,
      incomeNil: true,
      income: [],
      assetsNil: true,
      assets: [],
      liabilitiesNil: true,
      liabilities: [],
    },
    {
      personKey: `child:${BARAKA}`,
      personName: { surname: 'Kamau', firstName: 'Baraka' },
      statementDate: '2025-11-01',
      incomePeriod: period,
      incomeNil: true,
      income: [],
      assetsNil: false,
      assets: [
        {
          id: '0192f1a0-5a11-7000-8000-00000000c201',
          type: 'bank-account',
          description: 'Junior savings account',
          details: { institution: 'KCB Bank', accountType: 'Junior savings' },
          value: { kesCents: 4_500_000 },
          location: nairobi,
          joint: { isJoint: false },
          change: { changed: false },
        },
      ],
      liabilitiesNil: true,
      liabilities: [],
    },
  ],
  otherInformation: {
    materialChanges: [
      {
        personKey: 'officer',
        itemId: VEHICLE_ID,
        itemDescription: 'Toyota Prado, KDH 120J',
        kind: 'value-change',
        explanation: 'Valued lower after two years of use.',
      },
    ],
    registrableInterests: {
      directorships: [],
      memberships: [{ entity: 'Kenya Institute of Supplies Management', kind: 'society' }],
      dualCitizenship: { holds: false, pendingApplication: false },
      pendingCases: [],
    },
    freeText: '',
  },
  attestation: {
    text: 'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.',
    declaredAt: '2026-04-12T09:14:00Z',
    reference: 'DCB-PSC-2025-0004127-M',
  },
};
