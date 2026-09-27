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
export type WorkspaceHref = '/commissions';

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
export const COMMISSION_WRITE_ROLES = ['platform-admin'] as const;

/** Console areas, in display order, with the realm roles that open each one (architecture section 7). */
const WORKSPACES: WorkspaceDefinition[] = [
  {
    id: 'commissions',
    title: 'Commissions',
    description: 'Create Responsible Commissions and assign their reporting officers.',
    readOnlyDescription: 'Responsible Commissions, their reporting officers and roster coverage.',
    href: '/commissions',
    roles: ['platform-admin', 'eacc-analyst', 'eacc-supervisor'],
    writeRoles: COMMISSION_WRITE_ROLES,
  },
  {
    id: 'review',
    title: 'Review queue',
    description: 'Analyse declarations, raise clarifications and propose determinations.',
    roles: ['reviewer', 'supervisor'],
  },
  {
    id: 'approvals',
    title: 'Approvals',
    description: 'Approve determinations and administrative actions proposed by reviewers.',
    roles: ['supervisor'],
  },
  {
    id: 'access',
    title: 'Access requests',
    description: 'Decide Form K and law enforcement requests for declarations.',
    roles: ['access-officer'],
  },
  {
    id: 'roster',
    title: 'Declarant roster',
    description:
      "Import and maintain your Commission's roster and help officers who cannot onboard.",
    roles: ['reporting-officer'],
  },
  {
    id: 'commission',
    title: 'Commission administration',
    description: 'Manage users, policies and document templates for your Commission.',
    roles: ['commission-admin'],
  },
  {
    id: 'compliance',
    title: 'Compliance reports',
    description: 'Receive Form M reports and build the national consolidated report.',
    roles: ['eacc-analyst', 'eacc-supervisor'],
  },
  {
    id: 'audit',
    title: 'Audit trail',
    description: 'Investigate who did what, and when, across the platform.',
    roles: ['auditor'],
  },
  {
    id: 'support',
    title: 'Account support',
    description: 'Help users unlock accounts and recover access.',
    roles: ['helpdesk'],
  },
  {
    id: 'platform',
    title: 'Platform settings',
    description: 'Operate the platform: tenants, integrations and configuration.',
    roles: ['platform-admin'],
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
