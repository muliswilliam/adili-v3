export interface Workspace {
  id: string;
  title: string;
  description: string;
}

/** Console areas, in display order, with the realm roles that open each one (architecture section 7). */
const WORKSPACES: (Workspace & { roles: readonly string[] })[] = [
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
    id: 'employment',
    title: 'Employment verification',
    description: 'Confirm employment claims and upload staff rosters.',
    roles: ['hr-focal-point'],
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

/** The console areas a user's roles give access to. */
export function workspacesFor(roles: readonly string[]): Workspace[] {
  return WORKSPACES.filter((workspace) => workspace.roles.some((role) => roles.includes(role))).map(
    ({ id, title, description }) => ({ id, title, description }),
  );
}
