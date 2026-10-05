/**
 * Form M, EACC's intake, the national consolidated report and open data (#619, specs 09 and
 * 09b), built on the seeded filings and actions so their figures reconcile.
 */

/**
 * The financial year Form M is filed for: 2025/2026, the first year reports exist for and the one
 * both demo cycles' obligations fall in. Its reports were due on 31 July 2026, so every report
 * filed now is late, as EACC's chase from 1 August says.
 */
export const FORM_M_FY = 2025;

/** A Commission officer the realm file does not hold, made a demo account by the seed. */
export interface FormMOfficer {
  demoKey: string;
  firstName: string;
  lastName: string;
  role: 'supervisor' | 'commission-admin';
  tenant: string;
}

/** What each Commission's Form M is at in the demo, and who compiles and confirms it. */
export type FormMPlan =
  /** Compiled and reviewed, Part I filled: the commission-admin confirms it live. */
  | { slug: string; state: 'ready'; supervisor: string; commissionAdmin: string }
  /** Compiled, reviewed and confirmed on the platform. */
  | { slug: string; state: 'confirmed'; supervisor: string; commissionAdmin: string }
  /**
   * Filed by the Commission's own system through the federated API (ADR-009): its figures are the
   * ones a hosted compile gives, signed off in that system.
   */
  | {
      slug: string;
      state: 'federated';
      supervisor: string;
      compiledBy: { name: string; designation: string };
      confirmedBy: { name: string; designation: string };
    }
  /** Never filed: EACC's chase names it. */
  | { slug: string; state: 'not-reported' };

/** The Form M officers of the Commissions the realm gives only a reporting officer. */
export const FORM_M_OFFICERS: readonly FormMOfficer[] = [
  {
    demoKey: 'tsc-supervisor',
    firstName: 'Ruth',
    lastName: 'Nyambura',
    role: 'supervisor',
    tenant: 'tsc',
  },
  {
    demoKey: 'jsc-supervisor',
    firstName: 'Peter',
    lastName: 'Kimani',
    role: 'supervisor',
    tenant: 'jsc',
  },
  {
    demoKey: 'jsc-commission-admin',
    firstName: 'Anne',
    lastName: 'Atieno',
    role: 'commission-admin',
    tenant: 'jsc',
  },
  {
    demoKey: 'npsc-supervisor',
    firstName: 'Hassan',
    lastName: 'Omar',
    role: 'supervisor',
    tenant: 'npsc',
  },
  {
    demoKey: 'npsc-commission-admin',
    firstName: 'Lucy',
    lastName: 'Chebet',
    role: 'commission-admin',
    tenant: 'npsc',
  },
];

/** Each volume Commission's supervisor: approves its reviewers' determinations and its notices. */
export const SUPERVISORS: Record<string, string> = {
  psc: 'supervisor',
  tsc: 'tsc-supervisor',
  jsc: 'jsc-supervisor',
  npsc: 'npsc-supervisor',
};

/**
 * Five Commissions, one of each Form M state the demo shows: PSC's draft ready to confirm live,
 * JSC and NPSC confirmed on the platform, TSC filed from its own system, and EACC (for its own
 * staff) chased and never reported. EACC is the one left out because its staff roster in the demo
 * is a single officer (the two-missed-cycles referral): figures over one officer are suppressed,
 * and complementary suppression would then blank most of the national tables.
 */
export const FORM_M_PLANS: readonly FormMPlan[] = [
  { slug: 'psc', state: 'ready', supervisor: 'supervisor', commissionAdmin: 'commission-admin' },
  {
    slug: 'jsc',
    state: 'confirmed',
    supervisor: 'jsc-supervisor',
    commissionAdmin: 'jsc-commission-admin',
  },
  {
    slug: 'npsc',
    state: 'confirmed',
    supervisor: 'npsc-supervisor',
    commissionAdmin: 'npsc-commission-admin',
  },
  {
    slug: 'tsc',
    state: 'federated',
    supervisor: 'tsc-supervisor',
    compiledBy: { name: 'Ruth Nyambura', designation: 'Deputy Director, Compliance' },
    confirmedBy: { name: 'Dr. Evaleen Mitei', designation: 'Commission Secretary' },
  },
  { slug: 'eacc', state: 'not-reported' },
];

/**
 * The review work in the Commissions other than PSC (whose states #618 seeds), so the national
 * figures count determinations, clarifications and notices: per Commission, this many clean
 * current-cycle cases determined compliant, and this many more clarified (asked, answered,
 * resolved) and then determined. Every notice to comply the Commission's overdue officers' ladders
 * propose is approved.
 */
export const VOLUME_REVIEW = { determined: 14, clarified: 11 } as const;

/** The volume Commissions whose review work `VOLUME_REVIEW` seeds. */
export const VOLUME_REVIEW_COMMISSIONS = ['tsc', 'jsc', 'npsc'] as const;

/** What the volume clarifications ask and answer, and the determinations say. */
export const VOLUME_TEXT = {
  item: 'Please confirm the source of the increase in your bank balances since your previous declaration.',
  response:
    'The increase is my salary savings and a SACCO dividend paid in March; statements attached to my file at the registry.',
  note: 'Explained: savings and a SACCO dividend, consistent with the declared income.',
  reasons:
    'The declaration is complete and consistent with the previous declaration and the registries.',
} as const;

/** Part I contact details and Part B per Commission (the commission-admin enters them). */
export const FORM_M_MANUAL: Record<
  string,
  { contactDetails: string; physicalAddress: string; emailAddress: string }
> = {
  psc: {
    contactDetails: 'Director, Compliance and Quality Assurance, +254 20 2223901',
    physicalAddress: 'Commission House, Harambee Avenue, Nairobi',
    emailAddress: 'compliance@publicservice.go.ke',
  },
  jsc: {
    contactDetails: 'Registrar, Judicial Service Commission, +254 20 2221221',
    physicalAddress: 'Supreme Court Building, City Hall Way, Nairobi',
    emailAddress: 'compliance@jsc.go.ke',
  },
  npsc: {
    contactDetails: 'Director, Human Resource Management, +254 20 2726900',
    physicalAddress: 'Skypark Plaza, Westlands, Nairobi',
    emailAddress: 'compliance@npsc.go.ke',
  },
  tsc: {
    contactDetails: 'Director, Staff Management, +254 20 2892000',
    physicalAddress: 'TSC House, Kilimanjaro Road, Upper Hill, Nairobi',
    emailAddress: 'compliance@tsc.go.ke',
  },
};

/** The designations Part III names. */
export const SUPERVISOR_DESIGNATION = 'Deputy Director, Compliance';
export const COMMISSION_ADMIN_DESIGNATION = 'Commission Secretary';

/** Why EACC withdrew the first annual open-data release (shown with it in the public API). */
export const WITHDRAW_REASON =
  'Replaced by version 2: version 1 was published before EACC finished its quality check of the release.';
