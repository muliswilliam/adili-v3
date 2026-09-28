import type { IconProps } from '@adili/ui';
import { Building03Icon, Key01Icon, UserGroupIcon } from '@hugeicons/core-free-icons';

import { type WorkspaceHref, workspacesFor } from '../workspaces';

type NavIcon = IconProps['icon'];

/** Sidebar destinations: workspaces, and pages inside one that get their own entry. */
export type NavHref = WorkspaceHref | '/roster/api-access';

export interface NavItem {
  label: string;
  icon: NavIcon;
  to: NavHref;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

interface NavDefinition {
  workspace: string;
  icon: NavIcon;
  /** Defaults to the workspace's title. */
  label?: string;
  /** A page inside the workspace instead of the workspace itself. */
  to?: NavHref;
  /** Listed only to users who may change things in the workspace. */
  writeOnly?: boolean;
}

/**
 * Sidebar groups in the prototype's order (`consoleShell` in the kit). Each item belongs to a
 * workspace and is listed only when that workspace is built (has an `href`) and the user's roles
 * open it.
 */
const NAV: { label: string; items: NavDefinition[] }[] = [
  { label: 'Platform', items: [{ workspace: 'commissions', icon: Building03Icon }] },
  {
    label: 'Commission',
    items: [
      { workspace: 'roster', icon: UserGroupIcon, label: 'Roster' },
      // Credentials are the reporting officer's alone (the directory refuses anyone else).
      {
        workspace: 'roster',
        icon: Key01Icon,
        label: 'API access',
        to: '/roster/api-access',
        writeOnly: true,
      },
    ],
  },
];

/** The sidebar for a user's roles; groups with nothing to show are left out. */
export function navFor(roles: readonly string[]): NavGroup[] {
  const open = new Map(
    workspacesFor(roles).flatMap((workspace) =>
      workspace.href ? [[workspace.id, { ...workspace, href: workspace.href }] as const] : [],
    ),
  );
  return NAV.flatMap((group) => {
    const items = group.items.flatMap(({ workspace, icon, label, to, writeOnly }): NavItem[] => {
      const entry = open.get(workspace);
      if (!entry || (writeOnly && entry.readOnly)) return [];
      return [{ label: label ?? entry.title, icon, to: to ?? entry.href }];
    });
    return items.length > 0 ? [{ label: group.label, items }] : [];
  });
}

/**
 * The sidebar entry for the page at `pathname`: the deepest one containing it, so a page inside
 * a workspace with its own entry (API access) marks that entry, not the workspace's.
 */
export function activeNavHref(groups: NavGroup[], pathname: string): NavHref | null {
  let active: NavHref | null = null;
  for (const item of groups.flatMap((group) => group.items)) {
    const contains = pathname === item.to || pathname.startsWith(`${item.to}/`);
    if (contains && (active === null || item.to.length > active.length)) active = item.to;
  }
  return active;
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
