import type { Holdings } from './declaration.js';
import type { RosterRow } from './roster.js';

/** The demo's two biennial cycles (see `steps/cycles.ts`). */
export const PREVIOUS_CYCLE = 2024;
export const CURRENT_CYCLE = 2026;

/** What a persona has filed by checkpoint `0-start`. */
export interface PersonaFilings {
  /** The previous cycle's declaration, filed. */
  previous: Holdings;
  /** The current cycle's declaration, filed; absent when the persona files it live. */
  current?: Holdings;
  /** Amended to version 2 with these holdings after filing `current`. */
  amendedTo?: Holdings;
  /**
   * The current cycle's declaration started, holding what carries over unchanged from `previous`
   * (`startCarriedOver`), and left as a draft for the live filing (#682).
   */
  startsCurrent?: true;
}

/** A declarant the demo names (#617 personas table): onboarded and a demo account. */
export interface Persona {
  demoKey: string;
  commission: string;
  /** Their row in the Commission's roster fixture, by national ID. */
  nationalId: string;
  filings: PersonaFilings;
  /** What the demo shows with them. */
  purpose: string;
}

const KES = (shillings: number) => shillings;

/**
 * Wanjiku files her current declaration live: Check registries offers the Fielder and the Kiambu
 * parcel, Read into the form fills her payslip, and after submit the registry check raises the
 * Prado, the Kajiado parcel and Afya Bora (`mocks/demo/REGISTRY_FLAGS.md`). Both were registered
 * after the previous cycle's statement date, so her previous declaration rightly lacks them.
 */
const WANJIKU_PREVIOUS: Holdings = {
  salaryKes: KES(5_880_000),
  employer: 'Kenya Medical Supplies Authority',
  vehicles: [{ registration: 'KCX 214J', makeModel: 'Toyota Fielder (2016)', valueKes: 1_150_000 }],
  parcels: [
    {
      parcelNumber: 'KIAMBU/RUIRU EAST BLOCK 2/4417',
      description: 'Residential plot, Ruiru',
      size: '0.045 ha',
      county: '022',
      valueKes: 3_800_000,
    },
  ],
  companies: [],
  loans: [
    {
      creditor: 'Kenya Medical Supplies Sacco',
      description: 'Development loan',
      outstandingKes: 640_000,
    },
  ],
};

export const PERSONAS: readonly Persona[] = [
  {
    demoKey: 'wanjiku',
    commission: 'psc',
    nationalId: '27451863',
    filings: { previous: WANJIKU_PREVIOUS, startsCurrent: true },
    purpose:
      'Live filing: Check registries, Read into the form, Ask Adili, submit; then the 07b flags (Prado, Kajiado, Afya Bora supplier)',
  },
  {
    demoKey: 'otieno',
    commission: 'psc',
    nationalId: '30194427',
    filings: {
      previous: {
        salaryKes: 2_640_000,
        employer: 'Ministry of Health',
        vehicles: [],
        parcels: [],
        companies: [],
        loans: [],
      },
      current: {
        salaryKes: 2_880_000,
        employer: 'Ministry of Health',
        vehicles: [],
        parcels: [],
        companies: [],
        loans: [],
      },
    },
    purpose: 'Filed, clean: no flags, the AI does not cry wolf',
  },
  {
    demoKey: 'kiprono',
    commission: 'psc',
    nationalId: '22607781',
    filings: {
      previous: {
        salaryKes: 5_040_000,
        employer: 'Public Service Commission',
        vehicles: [
          { registration: 'KDA 118Q', makeModel: 'Nissan X-Trail (2019)', valueKes: 2_300_000 },
        ],
        parcels: [
          {
            parcelNumber: 'NAIROBI/BLOCK 82/1934',
            description: 'Leasehold plot, Nairobi',
            size: '0.093 ha',
            county: '047',
            valueKes: 9_500_000,
          },
        ],
        companies: [
          {
            name: 'Rift Valley Agrovet Limited',
            role: 'Shareholder (250 shares)',
            valueKes: 250_000,
          },
        ],
        loans: [],
      },
      current: {
        salaryKes: 5_280_000,
        employer: 'Public Service Commission',
        vehicles: [
          { registration: 'KDA 118Q', makeModel: 'Nissan X-Trail (2019)', valueKes: 2_000_000 },
        ],
        parcels: [
          {
            parcelNumber: 'NAIROBI/BLOCK 82/1934',
            description: 'Leasehold plot, Nairobi',
            size: '0.093 ha',
            county: '047',
            valueKes: 10_500_000,
          },
        ],
        companies: [
          {
            name: 'Rift Valley Agrovet Limited',
            role: 'Shareholder (250 shares)',
            valueKes: 250_000,
          },
        ],
        loans: [],
      },
    },
    purpose: 'Filed with a KRA non-compliance flag (clarification seeded in #618)',
  },
  {
    demoKey: 'amina',
    commission: 'psc',
    nationalId: '31552094',
    filings: {
      previous: {
        salaryKes: 3_120_000,
        employer: 'Public Service Commission',
        vehicles: [],
        parcels: [],
        companies: [],
        loans: [],
      },
      current: {
        salaryKes: 3_360_000,
        employer: 'Public Service Commission',
        vehicles: [],
        parcels: [],
        companies: [],
        loans: [],
      },
      amendedTo: {
        salaryKes: 3_360_000,
        employer: 'Public Service Commission',
        vehicles: [],
        parcels: [],
        companies: [],
        loans: [
          { creditor: 'Equity Bank Kenya', description: 'Personal loan', outstandingKes: 420_000 },
        ],
      },
    },
    purpose: 'Filed, then amended to version 2: version compare, superseded slip',
  },
];

/**
 * Officers on the PSC roster who are not onboarded at `0-start`:
 * - Achieng Njeri (roster fixture) onboards live with her SMS code.
 * - Daniel Rotich's roster name is not IPRS's for his ID: onboarding fails the identity check.
 */
export const ROSTER_ONLY: readonly { nationalId: string; purpose: string }[] = [
  { nationalId: '28836510', purpose: 'Live onboarding with SMS OTP' },
  { nationalId: '38221907', purpose: 'IPRS name mismatch: the spec 03 identity check fails' },
];

/** PSC roster rows the fixture file does not hold. */
export const EXTRA_PSC_ROWS: readonly RosterRow[] = [
  {
    personnelFileNumber: 'PSC/2016/0533',
    fullName: 'Daniel Kiprop Rotich',
    nationalId: '38221907',
    designation: 'Records Officer',
    jobGroup: 'H',
    reportingEntity: 'Public Service Commission',
    employerCode: 'PSC',
    appointmentDate: '2016-03-01',
    email: 'daniel.rotich@publicservice.go.ke',
    phone: '+254712000007',
  },
];

/**
 * Officers whose obligations show the reminders (Mailpit and the SMS inbox): appointed relative
 * to the day the seed first runs, which `steps/rosters.ts` keeps on later runs.
 * - The reminder officer's initial is due tomorrow: the 1-day reminder goes out today.
 * - The overdue officer's initial was due 15 days ago and is not filed.
 */
export const TIMED_OFFICERS: readonly {
  key: 'reminder' | 'overdue';
  demoKey: string;
  daysSinceAppointment: number;
  row: Omit<RosterRow, 'appointmentDate'>;
}[] = [
  {
    key: 'reminder',
    demoKey: 'reminder-officer',
    daysSinceAppointment: 29,
    row: {
      personnelFileNumber: 'PSC/2026/0911',
      fullName: 'Faith Wanjiru Mwende',
      nationalId: '39410622',
      designation: 'Administrative Officer',
      jobGroup: 'K',
      reportingEntity: 'Public Service Commission',
      employerCode: 'PSC',
      email: 'faith.mwende@publicservice.go.ke',
      phone: '+254712000008',
    },
  },
  {
    key: 'overdue',
    demoKey: 'overdue-officer',
    daysSinceAppointment: 45,
    row: {
      personnelFileNumber: 'PSC/2026/0874',
      fullName: 'Collins Otieno Were',
      nationalId: '39410623',
      designation: 'ICT Officer',
      jobGroup: 'K',
      reportingEntity: 'Public Service Commission',
      employerCode: 'PSC',
      email: 'collins.were@publicservice.go.ke',
      phone: '+254712000009',
    },
  },
];
