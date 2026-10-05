import type { Assert, Same } from '@adili/ui';
import { createContext, useContext } from 'react';
import { z } from 'zod';

import type { HelpScope } from '../../server/help.server';
import type { SearchAsDeclarants } from './search-drawer';
import { PLATFORM_TENANT } from '../organisation';
import { workspaceFor } from '../workspaces';

/**
 * Whose help the viewer works on: a platform admin the platform's articles and the corpus; a
 * Commission's administrator or reporting officer the Commission's (the session's tenant) and
 * its question themes.
 */
export interface HelpWorkspace {
  scope: HelpScope;
  /** Reporting officers read the Commission's articles; they do not edit them. */
  readOnly: boolean;
}

export const HELP_SCOPE_KINDS = ['platform', 'commission'] as const;
export type HelpScopeKind = (typeof HELP_SCOPE_KINDS)[number];

export type ContractHelpScopeKinds = Assert<Same<HelpScopeKind, HelpScope['kind']>>;

/** The console workspace each help workspace opens under. */
export const HELP_WORKSPACE_IDS: Record<HelpScopeKind, 'platform-help' | 'help'> = {
  platform: 'platform-help',
  commission: 'help',
};

/**
 * The help pages' URL state: which help workspace a viewer who may open both works on. Absent,
 * the platform's; the help pages keep it on their links to each other.
 */
export const helpScopeSearch = z.object({
  scope: z.enum(HELP_SCOPE_KINDS).optional().catch(undefined),
});

/**
 * The help workspace a page belongs to, when only one has it: the question themes are a
 * Commission's, the legal corpus the platform's. A link to either without `scope` opens it.
 */
export function helpScopeOfPage(pathname: string): HelpScopeKind | undefined {
  if (pathname.startsWith('/help/themes')) return 'commission';
  if (pathname.startsWith('/help/corpus')) return 'platform';
  return undefined;
}

/** Every help workspace the viewer may open, the platform's first; none for anyone else. */
export function helpWorkspacesFor(
  roles: readonly string[],
  tenant: string | null,
): HelpWorkspace[] {
  const workspaces: HelpWorkspace[] = [];
  if (workspaceFor(roles, HELP_WORKSPACE_IDS.platform)) {
    workspaces.push({ scope: { kind: 'platform' }, readOnly: false });
  }
  const commission = workspaceFor(roles, HELP_WORKSPACE_IDS.commission);
  if (commission && tenant && tenant !== PLATFORM_TENANT) {
    workspaces.push({ scope: { kind: 'commission', slug: tenant }, readOnly: commission.readOnly });
  }
  return workspaces;
}

/** The help workspace `chosen` when the viewer may open it, else their first; null for none. */
export function helpWorkspaceFor(
  roles: readonly string[],
  tenant: string | null,
  chosen?: HelpScopeKind,
): HelpWorkspace | null {
  const workspaces = helpWorkspacesFor(roles, tenant);
  return workspaces.find((each) => each.scope.kind === chosen) ?? workspaces[0] ?? null;
}

/** A help workspace the viewer may switch to, by name: "Platform", or their Commission's. */
export interface HelpScopeChoice {
  kind: HelpScopeKind;
  label: string;
}

/**
 * What the help pages share while the viewer stays in them: the article published last, so the
 * help search drawer marks it "Just published", the search it runs (the server function, or a
 * fake in tests), and the help workspaces the viewer may switch between (more than one only
 * for a platform admin who also holds a Commission role).
 */
export interface HelpSession {
  justPublished: string | null;
  setJustPublished: (articleId: string | null) => void;
  searchAsDeclarants: SearchAsDeclarants;
  onUnauthenticated: () => void;
  scopes: readonly HelpScopeChoice[];
  chooseScope: (kind: HelpScopeKind) => void;
}

export const HelpSessionContext = createContext<HelpSession>({
  justPublished: null,
  setJustPublished: () => undefined,
  searchAsDeclarants: () =>
    Promise.resolve({ ok: false, error: { kind: 'unavailable', detail: null } }),
  onUnauthenticated: () => undefined,
  scopes: [],
  chooseScope: () => undefined,
});

export function useHelpSession(): HelpSession {
  return useContext(HelpSessionContext);
}
