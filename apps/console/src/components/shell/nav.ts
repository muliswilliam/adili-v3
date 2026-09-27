import type { IconProps } from '@adili/ui';
import { Building03Icon } from '@hugeicons/core-free-icons';
import type { LinkProps } from '@tanstack/react-router';

import type { StaffRole } from '../../lib/roles';
import { type WorkspaceId, workspacesFor } from '../workspaces';

type NavIcon = IconProps['icon'];

export interface NavItem {
  label: string;
  icon: NavIcon;
  to: NonNullable<LinkProps['to']>;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Sidebar groups in the prototype's order (`consoleShell` in the kit). Each item is a workspace;
 * only workspaces that are built (have an `href`) and that the user's roles open are listed.
 */
const NAV: { label: string; items: { workspace: WorkspaceId; icon: NavIcon }[] }[] = [
  { label: 'Platform', items: [{ workspace: 'commissions', icon: Building03Icon }] },
];

/** The sidebar for a user's roles; groups with nothing to show are left out. */
export function navFor(roles: readonly string[]): NavGroup[] {
  const open = new Map(
    workspacesFor(roles).flatMap((workspace) =>
      workspace.href
        ? [[workspace.id, { label: workspace.title, to: workspace.href }] as const]
        : [],
    ),
  );
  return NAV.flatMap((group) => {
    const items = group.items.flatMap(({ workspace, icon }) => {
      const entry = open.get(workspace);
      return entry ? [{ ...entry, icon }] : [];
    });
    return items.length > 0 ? [{ label: group.label, items }] : [];
  });
}

/** Realm roles as the console names them, most senior first. */
const ROLE_LABELS: [role: StaffRole, label: string][] = [
  ['platform-admin', 'Platform administrator'],
  ['eacc-supervisor', 'EACC supervisor'],
  ['eacc-analyst', 'EACC analyst'],
  ['commission-admin', 'Commission administrator'],
  ['supervisor', 'Supervisor'],
  ['reviewer', 'Reviewer'],
  ['reporting-officer', 'Reporting officer'],
  ['access-officer', 'Access officer'],
  ['law-enforcement', 'Law enforcement'],
  ['auditor', 'Auditor'],
  ['helpdesk', 'Helpdesk'],
];

/** The label for a user's most senior console role, or null when they have none. */
export function roleLabel(roles: readonly string[]): string | null {
  return ROLE_LABELS.find(([role]) => roles.includes(role))?.[1] ?? null;
}

/** Up to two initials for the avatar, e.g. "Juma Omondi" → "JO". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
