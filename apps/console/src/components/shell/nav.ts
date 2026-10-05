import type { IconProps } from '@adili/ui';
import { Key01Icon } from '@hugeicons/core-free-icons';

import { type WorkspaceHref, workspacesFor } from '../workspaces';

type NavIcon = IconProps['icon'];

/** Sidebar destinations: workspaces, and pages inside one that get their own entry. */
export type NavHref = WorkspaceHref | '/roster/api-access';

export interface NavItem {
  label: string;
  icon: NavIcon;
  to: NavHref;
  /** The paths the entry stands for when wider than `to`, e.g. every tab of a workspace. */
  section?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

interface NavDefinition {
  workspace: string;
  /** Defaults to the workspace's icon, the one its home card shows. */
  icon?: NavIcon;
  /** Defaults to the workspace's title. */
  label?: string;
  /** A page inside the workspace instead of the workspace itself. */
  to?: NavHref;
  /** Listed only to users who may change things in the workspace. */
  writeOnly?: boolean;
  /** The paths the entry stands for when wider than where it links. */
  section?: string;
}

/**
 * Sidebar groups in the prototype's order (`consoleShell` in the kit). Each item belongs to a
 * workspace and is listed only when that workspace is built (has an `href`) and the user's roles
 * open it.
 */
const NAV: { label: string; items: NavDefinition[] }[] = [
  {
    // Every Commission at once: the platform admin and EACC.
    label: 'National',
    items: [{ workspace: 'commissions' }, { workspace: 'national-obligations' }],
  },
  {
    label: 'Platform',
    items: [
      { workspace: 'platform' },
      { workspace: 'integrations' },
      { workspace: 'ai-policy' },
      { workspace: 'platform-help' },
    ],
  },
  {
    label: 'Support',
    items: [{ workspace: 'support' }],
  },
  {
    label: 'EACC',
    // The intake, its reports and the national report all sit under /eacc/reports.
    items: [
      { workspace: 'compliance', section: '/eacc/reports' },
      { workspace: 'referrals-intake' },
      { workspace: 'open-data' },
    ],
  },
  {
    label: 'Oversight',
    // Its tabs (events, integrity) all sit under /audit.
    items: [{ workspace: 'audit', section: '/audit' }],
  },
  {
    label: 'Law enforcement',
    items: [{ workspace: 'lea', label: 'Requests' }],
  },
  {
    label: 'Access',
    // Its tabs (requests, certified copies) all sit under /access.
    items: [{ workspace: 'access', section: '/access' }],
  },
  {
    label: 'Commission',
    items: [
      { workspace: 'roster', label: 'Roster' },
      // Credentials are the reporting officer's alone (the directory refuses anyone else).
      {
        workspace: 'roster',
        icon: Key01Icon,
        label: 'API access',
        to: '/roster/api-access',
        writeOnly: true,
      },
      { workspace: 'obligations' },
      { workspace: 'policy' },
      { workspace: 'open-data-preview' },
      { workspace: 'help' },
    ],
  },
  {
    label: 'Review',
    items: [
      { workspace: 'review' },
      { workspace: 'approvals' },
      { workspace: 'actions' },
      { workspace: 'referrals' },
    ],
  },
  {
    label: 'Reporting',
    items: [{ workspace: 'form-m' }],
  },
];

/** The sidebar for a user's roles; groups with nothing to show are left out. */
export function navFor(roles: readonly string[]): NavGroup[] {
  const open = new Map(workspacesFor(roles).map((workspace) => [workspace.id, workspace] as const));
  // A page two workspaces share (Help articles, for a platform admin who also holds a Commission
  // role) is listed once, in the first group that has it.
  const listed = new Set<string>();
  return NAV.flatMap((group) => {
    const items = group.items.flatMap(
      ({ workspace, icon, label, to, writeOnly, section }): NavItem[] => {
        const entry = open.get(workspace);
        if (!entry || (writeOnly && entry.readOnly)) return [];
        const href = to ?? entry.href;
        if (listed.has(href)) return [];
        listed.add(href);
        return [
          {
            label: label ?? entry.title,
            icon: icon ?? entry.icon,
            to: href,
            ...(section ? { section } : {}),
          },
        ];
      },
    );
    return items.length > 0 ? [{ label: group.label, items }] : [];
  });
}

/**
 * The sidebar entry for the page at `pathname`: the deepest one containing it, so a page inside
 * a workspace with its own entry (API access) marks that entry, not the workspace's.
 */
export function activeNavHref(groups: NavGroup[], pathname: string): NavHref | null {
  let active: { to: NavHref; depth: number } | null = null;
  for (const item of groups.flatMap((group) => group.items)) {
    const within = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
    const path = within(item.to)
      ? item.to
      : item.section && within(item.section)
        ? item.section
        : null;
    if (path !== null && (active === null || path.length > active.depth)) {
      active = { to: item.to, depth: path.length };
    }
  }
  return active?.to ?? null;
}
