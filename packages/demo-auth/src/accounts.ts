/**
 * The demo accounts the role switcher offers (#616), one list for the console, the portal and the
 * judges' pack. `demoKey` is the account's `demo_key` attribute in Keycloak: the realm file's demo
 * users carry theirs, and the demo seed gives the declarant personas theirs when it onboards them.
 */
export type DemoApp = 'console' | 'portal';

export interface DemoAccount {
  demoKey: string;
  /** The person, as the app shows them. */
  name: string;
  /** What they do, e.g. `Reviewer`. */
  role: string;
  /** The Commission or body they belong to, e.g. `PSC`; absent for the public. */
  organisation?: string;
  app: DemoApp;
  /** What the demo uses them for. */
  purpose: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    demoKey: 'reporting-officer',
    name: 'Grace Mutiso',
    role: 'Reporting officer',
    organisation: 'PSC',
    app: 'console',
    purpose: 'Imports the PSC roster; obligations and reminders',
  },
  {
    demoKey: 'tsc-reporting-officer',
    name: 'Jepkosgei Chelimo',
    role: 'Reporting officer',
    organisation: 'TSC',
    app: 'console',
    purpose: 'A second Commission: tenant isolation',
  },
  {
    demoKey: 'reviewer',
    name: 'Achieng Njeri',
    role: 'Reviewer',
    organisation: 'PSC',
    app: 'console',
    purpose: 'Review queue, registry flags, copilot, clarifications',
  },
  {
    demoKey: 'supervisor',
    name: 'David Ochieng',
    role: 'Supervisor',
    organisation: 'PSC',
    app: 'console',
    purpose: 'Approves determinations and actions; compiles Form M',
  },
  {
    demoKey: 'commission-admin',
    name: 'Mwangi Wairimu',
    role: 'Commission admin',
    organisation: 'PSC',
    app: 'console',
    purpose: 'Confirms and submits Form M; Commission settings',
  },
  {
    demoKey: 'jsc-commission-admin',
    name: 'Anne Atieno',
    role: 'Commission admin',
    organisation: 'JSC',
    app: 'console',
    purpose: "A submitted Form M; the Commission's open-data preview",
  },
  {
    demoKey: 'access-officer',
    name: 'Halima Yusuf',
    role: 'Access officer',
    organisation: 'PSC',
    app: 'console',
    purpose: 'Decides Form K and law enforcement requests',
  },
  {
    demoKey: 'eacc-analyst',
    name: 'Baraka Mutua',
    role: 'EACC analyst',
    organisation: 'EACC',
    app: 'console',
    purpose: 'Form M intake, referrals to ICMS, national report, open data',
  },
  {
    demoKey: 'eacc-supervisor',
    name: 'Nafula Wekesa',
    role: 'EACC supervisor',
    organisation: 'EACC',
    app: 'console',
    purpose: 'Approves the national report and open-data releases',
  },
  {
    demoKey: 'auditor',
    name: 'Kariuki Muriithi',
    role: 'Auditor',
    organisation: 'EACC',
    app: 'console',
    purpose: 'The audit trail across every flow',
  },
  {
    demoKey: 'helpdesk',
    name: 'Zawadi Akinyi',
    role: 'Helpdesk',
    organisation: 'Platform',
    app: 'console',
    purpose: 'Looks people up to unlock accounts',
  },
  {
    demoKey: 'platform-admin',
    name: 'Juma Omondi',
    role: 'Platform admin',
    organisation: 'Platform',
    app: 'console',
    purpose: 'Commissions, AI policy, registry integrations',
  },
  {
    demoKey: 'law-enforcement',
    name: 'Suleiman Ali',
    role: 'Law enforcement',
    organisation: 'DCI',
    app: 'console',
    purpose: 'Requests access to a declaration for an investigation',
  },
  {
    demoKey: 'wanjiku',
    name: 'Wanjiku Kamau',
    role: 'Declarant',
    organisation: 'KEMSA, PSC roster',
    app: 'portal',
    purpose: 'Live filing: registry pre-fill, reading documents, Ask Adili, submit',
  },
  {
    demoKey: 'otieno',
    name: 'Otieno Odhiambo',
    role: 'Declarant',
    organisation: 'PSC roster',
    app: 'portal',
    purpose: 'Filed, no flags',
  },
  {
    demoKey: 'kiprono',
    name: 'Kiprono Chebet',
    role: 'Declarant',
    organisation: 'PSC roster',
    app: 'portal',
    purpose: 'Filed, KRA non-compliant; answers a clarification',
  },
  {
    demoKey: 'amina',
    name: 'Amina Hassan',
    role: 'Declarant',
    organisation: 'PSC roster',
    app: 'portal',
    purpose: 'Amended to version 2; superseded slip',
  },
  {
    demoKey: 'declarant',
    name: 'Demo declarant',
    role: 'Declarant',
    organisation: 'PSC',
    app: 'portal',
    purpose: 'The realm demo declarant',
  },
  {
    demoKey: 'applicant',
    name: 'Njoki Wambua',
    role: 'Applicant',
    app: 'portal',
    purpose: 'A member of the public applying with Form K',
  },
];

/** The account `demoKey` names in `app`, or undefined. */
export function demoAccount(app: DemoApp, demoKey: string): DemoAccount | undefined {
  return DEMO_ACCOUNTS.find((account) => account.app === app && account.demoKey === demoKey);
}
