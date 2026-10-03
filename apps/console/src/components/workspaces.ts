import {
  ACCESS_OFFICER,
  AUDITOR,
  COMMISSION_ADMIN,
  COMMISSION_ROSTER_ROLES,
  COMMISSION_STAFF_ROLES,
  EACC_ROLES,
  HELPDESK,
  LAW_ENFORCEMENT,
  NATIONAL_ROLES,
  PLATFORM_ADMIN,
  REPORTING_OFFICER,
  REVIEWER,
  SUPERVISOR,
} from '@adili/roles';

export interface Workspace {
  id: string;
  title: string;
  description: string;
  /** Where the workspace lives; absent while it is not built yet. */
  href?: WorkspaceHref;
  /** The user may look but not change anything. */
  readOnly: boolean;
}

/** Routes of workspaces that exist so far. */
export type WorkspaceHref =
  | '/commissions'
  | '/roster'
  | '/obligations'
  | '/obligations/national'
  | '/review'
  | '/actions'
  | '/access/requests'
  | '/lea/requests'
  | '/platform/law-enforcement'
  | '/ai-policy';

interface WorkspaceDefinition {
  id: string;
  title: string;
  description: string;
  href?: WorkspaceHref;
  /** Realm roles that open the workspace. */
  roles: readonly string[];
  /** Roles that may also change things; everyone else in `roles` gets a read-only workspace. */
  writeRoles?: readonly string[];
  /** Shown instead of `description` to read-only users. */
  readOnlyDescription?: string;
}

/** Roles that manage Responsible Commissions; EACC analysts and supervisors only read them. */
export const COMMISSION_WRITE_ROLES = [PLATFORM_ADMIN] as const;

/** Roles that import and maintain a Commission's roster; commission admins only read it. */
export const ROSTER_WRITE_ROLES = [REPORTING_OFFICER] as const;

/**
 * The Commission's access officer works access requests; its supervisor reads them (spec 10).
 * Nobody else sees them, EACC included.
 */
export const ACCESS_ROLES = [ACCESS_OFFICER, SUPERVISOR] as const;

/** Roles that verify applicants, identify officers and decide; the supervisor only reads. */
export const ACCESS_WRITE_ROLES = [ACCESS_OFFICER] as const;

/**
 * Law enforcement officers, provisioned by EACC for their agency, file written requests to any
 * Commission and download what is granted (spec 10, Regs r.23).
 */
export const LEA_ROLES = [LAW_ENFORCEMENT] as const;

/** Platform administrators provision and revoke law enforcement officers' accounts (spec 10). */
export const PLATFORM_ROLES = [PLATFORM_ADMIN] as const;

/** The Commission's own staff, who see its declarants' obligations (spec 04). */
export const OBLIGATIONS_ROLES = COMMISSION_STAFF_ROLES;

/**
 * Roles that open their own Commission's obligations policy from the Obligations workspace and
 * change its start date (spec 04 access table). Platform admins use the Commission's page.
 */
export const OWN_POLICY_ROLES = [COMMISSION_ADMIN] as const;

/** Whether the viewer opens the Obligations workspace's policy page. */
export function opensOwnPolicy(roles: readonly string[]): boolean {
  return OWN_POLICY_ROLES.some((role) => roles.includes(role));
}

/** Roles that see (and change) a Commission's obligations policy on its page (spec 04 FE-4). */
export const COMMISSION_POLICY_ROLES = [PLATFORM_ADMIN] as const;

/** Whether the viewer gets the policy card on a Commission's page; EACC staff see counts only. */
export function readsCommissionPolicy(roles: readonly string[]): boolean {
  return COMMISSION_POLICY_ROLES.some((role) => roles.includes(role));
}

/** National roles, who see obligation counts per Commission but no declarant (spec 04). */
export const NATIONAL_OBLIGATIONS_ROLES = NATIONAL_ROLES;

/** Console areas, in display order, with the realm roles that open each one (architecture section 7). */
const WORKSPACES: WorkspaceDefinition[] = [
  {
    id: 'commissions',
    title: 'Commissions',
    description: 'Create Responsible Commissions and assign their reporting officers.',
    readOnlyDescription: 'Responsible Commissions, their reporting officers and roster coverage.',
    href: '/commissions',
    roles: NATIONAL_ROLES,
    writeRoles: COMMISSION_WRITE_ROLES,
  },
  {
    id: 'national-obligations',
    title: 'National obligations',
    description: 'Due and overdue counts per Commission.',
    href: '/obligations/national',
    roles: NATIONAL_OBLIGATIONS_ROLES,
  },
  {
    id: 'review',
    title: 'Review queue',
    description: 'Analyse declarations, raise clarifications and propose determinations.',
    href: '/review',
    roles: [REVIEWER, SUPERVISOR],
  },
  {
    id: 'actions',
    title: 'Actions',
    description:
      'Approve the notices and warnings drafted for overdue declarations and clarifications.',
    href: '/actions',
    roles: [REVIEWER, SUPERVISOR],
  },
  {
    id: 'approvals',
    title: 'Approvals',
    description: 'Approve determinations and administrative actions proposed by reviewers.',
    roles: [SUPERVISOR],
  },
  {
    id: 'access',
    title: 'Access requests',
    description: 'Decide Form K and law enforcement requests for declarations.',
    readOnlyDescription:
      'Form K and law enforcement requests for declarations and where each one stands.',
    href: '/access/requests',
    roles: ACCESS_ROLES,
    writeRoles: ACCESS_WRITE_ROLES,
  },
  {
    id: 'lea',
    title: 'Law enforcement requests',
    description:
      'Send written requests for declarations to Commissions and download what is granted.',
    href: '/lea/requests',
    roles: LEA_ROLES,
  },
  {
    id: 'roster',
    title: 'Declarant roster',
    description:
      "Import and maintain your Commission's roster and help officers who cannot onboard.",
    readOnlyDescription: "Your Commission's roster and import history.",
    href: '/roster',
    roles: COMMISSION_ROSTER_ROLES,
    writeRoles: ROSTER_WRITE_ROLES,
  },
  {
    id: 'obligations',
    title: 'Obligations',
    description: 'Who must declare, by when, and who has been reminded.',
    href: '/obligations',
    roles: OBLIGATIONS_ROLES,
  },
  {
    id: 'commission',
    title: 'Commission administration',
    description: 'Manage users, policies and document templates for your Commission.',
    roles: [COMMISSION_ADMIN],
  },
  {
    id: 'compliance',
    title: 'Compliance reports',
    description: 'Receive Form M reports and build the national consolidated report.',
    roles: EACC_ROLES,
  },
  {
    id: 'audit',
    title: 'Audit trail',
    description: 'Investigate who did what, and when, across the platform.',
    roles: [AUDITOR],
  },
  {
    id: 'support',
    title: 'Account support',
    description: 'Help users unlock accounts and recover access.',
    roles: [HELPDESK],
  },
  {
    id: 'ai-policy',
    title: 'AI policy',
    description: 'Which Commissions may use an AI provider, task routing and budgets.',
    href: '/ai-policy',
    roles: [PLATFORM_ADMIN],
  },
  {
    id: 'platform',
    title: 'Platform settings',
    description:
      'Operate the platform: law-enforcement accounts, tenants, integrations and configuration.',
    href: '/platform/law-enforcement',
    roles: PLATFORM_ROLES,
  },
];

const holdsAny = (roles: readonly string[], wanted: readonly string[]) =>
  wanted.some((role) => roles.includes(role));

/** The console areas a user's roles give access to. */
export function workspacesFor(roles: readonly string[]): Workspace[] {
  return WORKSPACES.filter((workspace) => holdsAny(roles, workspace.roles)).map(
    ({ id, title, description, href, writeRoles, readOnlyDescription }) => {
      const readOnly = writeRoles ? !holdsAny(roles, writeRoles) : false;
      return {
        id,
        title,
        description: readOnly && readOnlyDescription ? readOnlyDescription : description,
        href,
        readOnly,
      };
    },
  );
}

/** The workspace with `id` if the user's roles open it. */
export function workspaceFor(roles: readonly string[], id: string): Workspace | undefined {
  return workspacesFor(roles).find((workspace) => workspace.id === id);
}
