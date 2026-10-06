import { randomUUID } from 'node:crypto';

import { type Apis, ok } from '../clients/api.js';
import { jsonBody, requestJson, waitFor } from '../clients/http.js';
import type { KeycloakAdmin, KeycloakUser } from '../clients/keycloak.js';
import { uploadFile } from '../clients/uploads.js';
import { type RosterRow, rosterCsv, rosterDrift } from '../data/roster.js';
import type { SyntheticOfficer } from '../data/synthetic.js';

/**
 * Real end-to-end test accounts on the hosted demo (docs/demo-accounts.md): one per role, each
 * with a real mailbox at the e2e domain (Mailpit relays mail to it through the SMTP provider,
 * infra/azure/demo-vault.sh), real MFA and no `demo_key`, so the role switcher cannot sign them
 * in. Staff sign in with a password and an authenticator app they set up from Keycloak's email;
 * the law-enforcement officer is provisioned through the directory as the platform admin
 * provisions any; the declarant and the applicant are people in the simulated registries who
 * sign up themselves through the portal.
 */

/** Keycloak's actions for a new staff account: enrol an authenticator, set a password. */
export const STAFF_ACTIONS = ['CONFIGURE_TOTP', 'UPDATE_PASSWORD'] as const;
/** How long the setup link stays valid: 72 hours, as the directory's activation emails. */
export const SETUP_LINK_LIFESPAN_SECONDS = 72 * 3600;

/** A staff account: a Keycloak user with one realm role in one tenant. */
export interface StaffAccount {
  kind: 'staff';
  role: string;
  tenant: string;
  /** What the setup email names as where they are invited (the theme's `commissionName`). */
  organisation: string;
  username: string;
  email: string;
  lastName: string;
}

export interface LawEnforcementAccount {
  kind: 'law-enforcement';
  role: 'law-enforcement';
  agency: string;
  email: string;
  name: string;
  phone: string;
}

export interface DeclarantAccount {
  kind: 'declarant';
  role: 'declarant';
  commission: string;
  email: string;
}

export interface ApplicantAccount {
  kind: 'applicant';
  role: 'applicant';
  email: string;
}

export type E2eAccount = StaffAccount | LawEnforcementAccount | DeclarantAccount | ApplicantAccount;

const PSC = 'Public Service Commission';
const EACC = 'Ethics and Anti-Corruption Commission';
const PLATFORM = 'Adili Online';

/** The staff roles, their tenant and the name their setup email gives it. */
const STAFF: readonly { role: string; tenant: string; organisation: string; lastName: string }[] = [
  { role: 'reporting-officer', tenant: 'psc', organisation: PSC, lastName: 'Reporting Officer' },
  { role: 'reviewer', tenant: 'psc', organisation: PSC, lastName: 'Reviewer' },
  { role: 'supervisor', tenant: 'psc', organisation: PSC, lastName: 'Supervisor' },
  { role: 'commission-admin', tenant: 'psc', organisation: PSC, lastName: 'Commission Admin' },
  { role: 'access-officer', tenant: 'psc', organisation: PSC, lastName: 'Access Officer' },
  { role: 'eacc-analyst', tenant: 'eacc', organisation: EACC, lastName: 'EACC Analyst' },
  { role: 'eacc-supervisor', tenant: 'eacc', organisation: EACC, lastName: 'EACC Supervisor' },
  { role: 'auditor', tenant: 'eacc', organisation: EACC, lastName: 'Auditor' },
  { role: 'helpdesk', tenant: 'platform', organisation: PLATFORM, lastName: 'Helpdesk' },
  {
    role: 'platform-admin',
    tenant: 'platform',
    organisation: PLATFORM,
    lastName: 'Platform Admin',
  },
];

/** Every staff account's given name: the role is the family name, e.g. "E2E Reviewer". */
export const E2E_FIRST_NAME = 'E2E';

/** A domain the restore script and this module both accept: lowercase labels and dots. */
export function checkDomain(domain: string | undefined): string {
  const value = (domain ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) {
    throw new Error(
      `Set E2E_EMAIL_DOMAIN to the domain whose mail you read (e.g. example.com); got "${domain ?? ''}"`,
    );
  }
  return value;
}

/** Every e2e account, `<role>@<domain>`. */
export function e2eAccounts(domain: string): E2eAccount[] {
  const at = (role: string) => `${role}@${domain}`;
  return [
    ...STAFF.map((staff): StaffAccount => ({
      kind: 'staff',
      ...staff,
      username: `e2e-${staff.role}`,
      email: at(staff.role),
    })),
    {
      kind: 'law-enforcement',
      role: 'law-enforcement',
      agency: 'DCI',
      email: at('law-enforcement'),
      name: `${E2E_FIRST_NAME} Law Enforcement`,
      // Never texted: officers sign in with an authenticator app. Apart from every demo number.
      phone: '+254799999901',
    },
    { kind: 'declarant', role: 'declarant', commission: 'psc', email: at('declarant') },
    { kind: 'applicant', role: 'applicant', email: at('applicant') },
  ];
}

/** What a run did for an account, and how its owner goes on. */
export interface AccountReport {
  role: string;
  username: string;
  email: string;
  state: string;
  signIn: string;
  details: string;
  changed: number;
}

/**
 * A staff account set up for real use: created if missing with the role, the tenant, a verified
 * email, no `demo_key` and the actions to enrol TOTP and set a password; then Keycloak emails the
 * link that does both. An existing account is put back to that shape (role, attributes) and gets
 * the email again only with `resend` and while it has not finished. Never touches a credential.
 */
export async function ensureStaffAccount(
  keycloak: KeycloakAdmin,
  account: StaffAccount,
  options: { consoleUrl: string; resend: boolean },
): Promise<AccountReport> {
  const attributes = {
    tenant: [account.tenant],
    // The email theme names the role and where they are invited (apps/keycloak-theme).
    commissionName: [account.organisation],
    invitedRole: [account.role],
  };
  let changed = 0;
  let user = await keycloak.userByUsername(account.username);
  const created = !user;
  if (!user) {
    user = await keycloak.createUser({
      username: account.username,
      email: account.email,
      emailVerified: true,
      firstName: E2E_FIRST_NAME,
      lastName: account.lastName,
      enabled: true,
      attributes,
      requiredActions: [...STAFF_ACTIONS],
    });
    changed++;
  } else if (await keycloak.updateAttributes(user, attributes, ['demo_key'])) {
    changed++;
  }
  if (await keycloak.ensureRealmRole(user, account.role)) changed++;

  const pending = created ? [...STAFF_ACTIONS] : (user.requiredActions ?? []);
  if (created || (options.resend && pending.length > 0)) {
    await keycloak.sendExecuteActionsEmail(user, setupEmail(pending, options.consoleUrl));
  }
  return {
    role: account.role,
    username: account.username,
    email: account.email,
    state: created
      ? 'created, setup email sent'
      : pending.length === 0
        ? 'set up'
        : options.resend
          ? 'setup email sent again'
          : `setup pending (${pending.join(', ')})`,
    signIn: 'console: username or email, password, authenticator code',
    details: `tenant ${account.tenant}`,
    changed,
  };
}

/** The setup link: runs `actions`, then back to the console's sign-in. */
export function setupEmail(actions: readonly string[], consoleUrl: string) {
  return {
    actions,
    lifespanSeconds: SETUP_LINK_LIFESPAN_SECONDS,
    clientId: 'console',
    redirectUri: new URL('/auth/login', consoleUrl).toString(),
  };
}

/**
 * The law-enforcement officer, provisioned by the platform admin through the directory (spec 10):
 * a directory person and a Keycloak account (the email as username, tenant `lea`, the agency) and
 * the directory's activation email (verify the email, enrol TOTP, set a password). Provisioned
 * again only with `resend` while still `invited`, which emails the link again.
 */
export async function ensureLawEnforcementAccount(
  platformAdmin: Apis,
  account: LawEnforcementAccount,
  options: { resend: boolean },
): Promise<AccountReport> {
  const officers = ok(
    await platformAdmin.directory.GET('/v1/law-enforcement/agencies/{code}/officers', {
      params: { path: { code: account.agency } },
    }),
    `list ${account.agency} officers`,
  );
  const existing = officers.find(
    (officer) => officer.email.toLowerCase() === account.email.toLowerCase(),
  );
  let officer = existing;
  if (!existing || (options.resend && existing.state === 'invited')) {
    officer = ok(
      await platformAdmin.directory.POST('/v1/law-enforcement/agencies/{code}/officers', {
        params: { path: { code: account.agency }, header: { 'Idempotency-Key': randomUUID() } },
        body: { name: account.name, email: account.email, phone: account.phone },
      }),
      `provision ${account.email}`,
    );
  }
  return {
    role: account.role,
    username: account.email,
    email: account.email,
    state: !existing
      ? 'provisioned, activation email sent'
      : officer !== existing
        ? 'activation email sent again'
        : existing.state === 'invited'
          ? 'activation pending'
          : existing.state,
    signIn: 'console: email, password, authenticator code',
    details: `agency ${account.agency}, person ${officer?.id ?? ''}`,
    changed: officer === existing ? 0 : 1,
  };
}

/**
 * The simulated registries' generator (`mocks/demo/synthetic.py`) makes the declarant's and the
 * applicant's records (IPRS, KRA, HR, registries) as it makes the demo's synthetic officers, in a
 * national ID block of their own (69,000,000 on), so they never meet a demo person.
 */
export const E2E_PEOPLE = {
  seed: 'adili-e2e-2026',
  anchor: '2026-10-01',
  slug: 'e2e',
  /** The generator's Commission index: the demo's Commissions are 0 to 4. */
  index: 9,
  employerCode: 'PSC',
  reportingEntity: PSC,
} as const;

/** The declarant's (first) and the applicant's (second) records in the simulated registries. */
export async function e2ePeople(
  mocksUrl: string,
  domain: string,
): Promise<{ created: number; declarant: SyntheticOfficer; applicant: SyntheticOfficer }> {
  const { body } = await requestJson<{
    created: number;
    officers: Record<string, SyntheticOfficer[]>;
  }>(`${mocksUrl}/demo/synthetic-officers`, {
    method: 'POST',
    ...jsonBody({
      seed: E2E_PEOPLE.seed,
      anchor: E2E_PEOPLE.anchor,
      commissions: [
        {
          slug: E2E_PEOPLE.slug,
          index: E2E_PEOPLE.index,
          count: 2,
          employerCode: E2E_PEOPLE.employerCode,
          reportingEntity: E2E_PEOPLE.reportingEntity,
          emailDomain: domain,
        },
      ],
    }),
    what: 'create the e2e people in the mocks',
  });
  const [declarant, applicant] = body.officers[E2E_PEOPLE.slug] ?? [];
  if (!declarant || !applicant) throw new Error('The mocks returned no e2e people');
  return { created: body.created, declarant, applicant };
}

/** The declarant's roster row: their registry records, with the e2e mailbox as email. */
export function declarantRow(person: SyntheticOfficer, email: string): RosterRow {
  return {
    personnelFileNumber: person.personnelFileNumber,
    fullName: person.fullName,
    nationalId: person.nationalId,
    designation: person.designation,
    jobGroup: person.jobGroup,
    reportingEntity: person.reportingEntity,
    employerCode: person.employerCode,
    appointmentDate: person.appointmentDate,
    email,
    phone: person.phone,
  };
}

/**
 * The declarant on the Commission's roster, imported by its reporting officer as a roster file
 * (as the console does) when missing or different, so they can onboard through the portal. Their
 * onboarding is their own: the email code comes to the e2e mailbox, the phone code to the demo
 * SMS inbox (console, Demo panel), then the set-password email.
 */
export async function ensureDeclarant(
  reportingOfficer: Apis,
  account: DeclarantAccount,
  person: SyntheticOfficer,
): Promise<AccountReport> {
  const row = declarantRow(person, account.email);
  const slug = account.commission;
  const listed = await findRecord(reportingOfficer, slug, row.personnelFileNumber);
  const held = listed
    ? ok(
        await reportingOfficer.directory.GET('/v1/commissions/{slug}/roster/records/{recordId}', {
          params: { path: { slug, recordId: listed.id } },
        }),
        `read ${row.personnelFileNumber}`,
      )
    : undefined;
  let record = listed;
  let changed = 0;
  if (!held || rosterDrift(held, row).length > 0) {
    await importRows(reportingOfficer, slug, [row]);
    changed++;
    record = await findRecord(reportingOfficer, slug, row.personnelFileNumber);
  }
  if (!record) throw new Error(`${row.personnelFileNumber} is missing after the import`);
  const onboarded = record.state === 'onboarded';
  return {
    role: account.role,
    username: onboarded && record.ofr ? record.ofr : '(their OFR, once onboarded)',
    email: account.email,
    state: onboarded ? 'onboarded' : record.state === 'exited' ? 'exited' : 'on the roster',
    signIn: onboarded
      ? 'portal: OFR or email, password, code (SMS by default; "send by email" for the mailbox)'
      : 'portal Get started: Commission PSC, personnel file number, national ID',
    details: `PSC, personnel file ${row.personnelFileNumber}, national ID ${row.nationalId}, ${row.fullName}, phone ${row.phone}`,
    changed,
  };
}

async function findRecord(api: Apis, slug: string, personnelFileNumber: string) {
  const page = ok(
    await api.directory.GET('/v1/commissions/{slug}/roster/records', {
      params: { path: { slug }, query: { search: personnelFileNumber, limit: 20 } },
    }),
    `find ${personnelFileNumber} on the ${slug} roster`,
  );
  return page.items.find(
    (item) => item.personnelFileNumber.toUpperCase() === personnelFileNumber.toUpperCase(),
  );
}

async function importRows(api: Apis, slug: string, rows: RosterRow[]): Promise<void> {
  const uploadId = await uploadFile(api, {
    purpose: 'roster-import',
    contentType: 'text/csv',
    fileName: `${slug}-e2e-roster.csv`,
    bytes: new TextEncoder().encode(rosterCsv(rows)),
  });
  const started = ok(
    await api.directory.POST('/v1/commissions/{slug}/roster/imports', {
      params: { path: { slug }, header: { 'Idempotency-Key': randomUUID() } },
      body: { channel: 'file', uploadId, declaredComplete: false },
    }),
    `import the e2e declarant into ${slug}`,
  );
  const done = await waitFor(
    `${slug} e2e roster import`,
    async () => {
      const current = ok(
        await api.directory.GET('/v1/commissions/{slug}/roster/imports/{importId}', {
          params: { path: { slug, importId: started.id } },
        }),
        `read ${slug} import`,
      );
      return current.state === 'completed' || current.state === 'failed' ? current : undefined;
    },
    { timeoutMs: 2 * 60_000, intervalMs: 1000 },
  );
  if (done.state === 'failed') {
    throw new Error(`${slug} e2e roster import failed: ${JSON.stringify(done.failure)}`);
  }
}

/**
 * The applicant: a person IPRS knows, who registers themselves on the portal (spec 10) with the
 * e2e mailbox. Reported as registered once their account exists.
 */
export async function applicantReport(
  keycloak: KeycloakAdmin,
  account: ApplicantAccount,
  person: SyntheticOfficer,
): Promise<AccountReport> {
  const user: KeycloakUser | undefined = await keycloak.userByEmail(account.email);
  return {
    role: account.role,
    username: account.email,
    email: account.email,
    state: user ? 'registered' : 'not registered yet',
    signIn: user
      ? 'portal: email, password, code (SMS by default; "send by email" for the mailbox)'
      : 'portal Request access, register: national ID and names below, any phone',
    details: `national ID ${person.nationalId}, ${person.fullName}`,
    changed: 0,
  };
}

/** The run's accounts as a Markdown table. Holds no secret: nothing here is one. */
export function reportTable(reports: readonly AccountReport[]): string {
  const header = ['Role', 'Username', 'Email', 'State', 'Sign in', 'Details'];
  const rows = reports.map((r) => [r.role, r.username, r.email, r.state, r.signIn, r.details]);
  const line = (cells: string[]) => `| ${cells.map((c) => c.replaceAll('|', '/')).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}
