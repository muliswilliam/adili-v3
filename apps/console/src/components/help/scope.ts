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

export type HelpScopeKind = HelpScope['kind'];

/**
 * The help pages' URL state: which help a viewer who may open both works on. Absent, the
 * platform's; the help pages keep it on their links to each other.
 */
export const helpScopeSearch = z.object({
  scope: z.enum(['platform', 'commission']).optional().catch(undefined),
});

/** Every help the viewer may open, the platform's first; none for anyone else. */
export function helpWorkspacesFor(
  roles: readonly string[],
  tenant: string | null,
): HelpWorkspace[] {
  const workspaces: HelpWorkspace[] = [];
  if (workspaceFor(roles, 'platform-help')) {
    workspaces.push({ scope: { kind: 'platform' }, readOnly: false });
  }
  const commission = workspaceFor(roles, 'help');
  if (commission && tenant && tenant !== PLATFORM_TENANT) {
    workspaces.push({ scope: { kind: 'commission', slug: tenant }, readOnly: commission.readOnly });
  }
  return workspaces;
}

/** The help `chosen` when the viewer may open it, else the first they may; null for none. */
export function helpWorkspaceFor(
  roles: readonly string[],
  tenant: string | null,
  chosen?: HelpScopeKind,
): HelpWorkspace | null {
  const workspaces = helpWorkspacesFor(roles, tenant);
  return workspaces.find((each) => each.scope.kind === chosen) ?? workspaces[0] ?? null;
}

/** One help the viewer may switch to, by name: "Platform", or their Commission's name. */
export interface HelpScopeChoice {
  kind: HelpScopeKind;
  label: string;
}

/**
 * What the help pages share while the viewer stays in them: the article published last, so the
 * help search drawer marks it "Just published", the search it runs (the server function, or a
 * fake in tests), and the helps the viewer may switch between (more than one only for a
 * platform admin who also holds a Commission role).
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
