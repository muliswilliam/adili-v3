/**
 * The demo's Commissions. psc, tsc and eacc come with the realm's staff accounts; jsc and npsc
 * give the national view scale, and one of the five can miss its Form M (#619). Every Commission
 * but EACC gets synthetic officers, so its statistics, Form M and open data show real figures.
 */
export interface DemoCommission {
  slug: string;
  name: string;
  categories: string[];
  /** Synthetic officers' employer and email domain. */
  employerCode: string;
  reportingEntity: string;
  emailDomain: string;
  /** Share of `DEMO_SEED_VOLUME` this Commission gets. */
  volumeShare: number;
  /**
   * Its reviewer's `demo_key`: the realm's `reviewer` for PSC; for the others an account the seed
   * creates (no API creates Commission staff), so their review queues can be read and worked.
   */
  reviewer: string;
  /** Its reporting officer: a realm account, or one the seed assigns and makes a demo account. */
  reportingOfficer: { demoKey: string; name: string; email: string; phone: string };
}

export const DEMO_COMMISSIONS: readonly DemoCommission[] = [
  {
    slug: 'psc',
    reviewer: 'reviewer',
    name: 'Public Service Commission',
    categories: ['act-s32-5', 'regs-r5-e', 'regs-r5-f'],
    employerCode: 'MOPS',
    reportingEntity: 'Ministry of Public Service',
    emailDomain: 'publicservice.go.ke',
    // Every PSC case asks the AI copilot (the gate lets the external provider see PSC's
    // synthetic data); the other Commissions carry the bulk.
    volumeShare: 0.2,
    reportingOfficer: {
      demoKey: 'reporting-officer',
      name: 'Grace Mutiso',
      email: 'reporting-officer@demo.adili.go.ke',
      phone: '+254700000002',
    },
  },
  {
    slug: 'tsc',
    reviewer: 'tsc-reviewer',
    name: 'Teachers Service Commission',
    categories: ['act-s32-10'],
    employerCode: 'TSCD',
    reportingEntity: 'Teachers Service Commission',
    emailDomain: 'tsc.go.ke',
    volumeShare: 1,
    reportingOfficer: {
      demoKey: 'tsc-reporting-officer',
      name: 'Jepkosgei Chelimo',
      email: 'tsc-reporting-officer@demo.adili.go.ke',
      phone: '+254700000014',
    },
  },
  {
    slug: 'eacc',
    reviewer: 'eacc-reviewer',
    name: 'Ethics and Anti-Corruption Commission',
    categories: ['regs-r5-a'],
    employerCode: 'EACC',
    reportingEntity: 'Ethics and Anti-Corruption Commission',
    emailDomain: 'eacc.go.ke',
    volumeShare: 0,
    reportingOfficer: {
      demoKey: 'eacc-reporting-officer',
      name: 'Halima Abdi',
      email: 'eacc-reporting-officer@demo.adili.go.ke',
      phone: '+254700000021',
    },
  },
  {
    slug: 'jsc',
    reviewer: 'jsc-reviewer',
    name: 'Judicial Service Commission',
    categories: ['act-s32-7'],
    employerCode: 'JUD',
    reportingEntity: 'The Judiciary',
    emailDomain: 'judiciary.go.ke',
    volumeShare: 1,
    reportingOfficer: {
      demoKey: 'jsc-reporting-officer',
      name: 'Wanjala Simiyu',
      email: 'jsc-reporting-officer@demo.adili.go.ke',
      phone: '+254700000022',
    },
  },
  {
    slug: 'npsc',
    reviewer: 'npsc-reviewer',
    name: 'National Police Service Commission',
    categories: ['act-s32-13'],
    employerCode: 'NPS',
    reportingEntity: 'National Police Service',
    emailDomain: 'npsc.go.ke',
    volumeShare: 1,
    reportingOfficer: {
      demoKey: 'npsc-reporting-officer',
      name: 'Kerubo Moraa',
      email: 'npsc-reporting-officer@demo.adili.go.ke',
      phone: '+254700000023',
    },
  },
];

/** The Commissions' index in `DEMO_COMMISSIONS`, which also numbers their synthetic ID blocks. */
export function commissionIndex(slug: string): number {
  const index = DEMO_COMMISSIONS.findIndex((commission) => commission.slug === slug);
  if (index === -1) throw new Error(`Unknown demo Commission ${slug}`);
  return index;
}
