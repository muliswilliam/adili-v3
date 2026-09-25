import type { LinkProps } from '@tanstack/react-router';

export interface Workspace {
  id: string;
  title: string;
  description: string;
  /** Where the workspace lives; workspaces without one are not built yet. */
  href?: LinkProps['to'];
}

interface WorkspaceEntry extends Workspace {
  /** Realm roles that open the workspace. */
  roles: readonly string[];
  /** Roles that may change things; everyone else in `roles` gets read-only access. */
  writeRoles?: readonly string[];
  /** Shown instead of `description` to read-only users. */
  readOnlyDescription?: string;
}

export type WorkspaceAccess = 'write' | 'read' | null;

/** Console areas, in display order, with the realm roles that open each one (architecture section 7). */
const WORKSPACES: WorkspaceEntry[] = [
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
    id: 'commissions',
    title: 'Commissions',
    description: 'Create Responsible Commissions and assign their reporting officers.',
    readOnlyDescription: 'Responsible Commissions, their reporting officers and roster coverage.',
    href: '/commissions',
    roles: ['platform-admin', 'eacc-analyst', 'eacc-supervisor'],
    writeRoles: ['platform-admin'],
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

function hasAny(roles: readonly string[], wanted: readonly string[]): boolean {
  return wanted.some((role) => roles.includes(role));
}

function accessTo(entry: WorkspaceEntry, roles: readonly string[]): WorkspaceAccess {
  if (!hasAny(roles, entry.roles)) return null;
  return !entry.writeRoles || hasAny(roles, entry.writeRoles) ? 'write' : 'read';
}

/** The console areas a user's roles give access to. */
export function workspacesFor(roles: readonly string[]): Workspace[] {
  return WORKSPACES.flatMap((entry) => {
    const access = accessTo(entry, roles);
    if (!access) return [];
    const { id, title, href } = entry;
    const description =
      access === 'read' && entry.readOnlyDescription
        ? entry.readOnlyDescription
        : entry.description;
    return [{ id, title, description, href }];
  });
}

/** Whether a user's roles open a workspace, and whether they may change things in it. */
export function workspaceAccess(id: string, roles: readonly string[]): WorkspaceAccess {
  const entry = WORKSPACES.find((workspace) => workspace.id === id);
  return entry ? accessTo(entry, roles) : null;
}
