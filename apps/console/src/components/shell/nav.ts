import type { IconProps } from '@adili/ui';
import { Building03Icon, UserGroupIcon } from '@hugeicons/core-free-icons';

import { type WorkspaceHref, workspacesFor } from '../workspaces';

type NavIcon = IconProps['icon'];

export interface NavItem {
  label: string;
  icon: NavIcon;
  to: WorkspaceHref;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Sidebar groups in the prototype's order (`consoleShell` in the kit). Each item is a workspace,
 * labelled with its title unless `label` is given; only workspaces that are built (have an
 * `href`) and that the user's roles open are listed.
 */
const NAV: { label: string; items: { workspace: string; icon: NavIcon; label?: string }[] }[] = [
  { label: 'Platform', items: [{ workspace: 'commissions', icon: Building03Icon }] },
  {
    label: 'Commission',
    items: [{ workspace: 'roster', icon: UserGroupIcon, label: 'Roster' }],
  },
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
    const items = group.items.flatMap(({ workspace, icon, label }) => {
      const entry = open.get(workspace);
      return entry ? [{ ...entry, ...(label ? { label } : {}), icon }] : [];
    });
    return items.length > 0 ? [{ label: group.label, items }] : [];
  });
}

/** Up to two initials for the avatar, e.g. "Juma Omondi" gives "JO". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
