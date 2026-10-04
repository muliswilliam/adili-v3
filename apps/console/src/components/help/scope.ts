import { createContext, useContext } from 'react';

import type { HelpScope } from '../../server/help.server';
import type { SearchAsDeclarants } from './search-drawer';
import { workspaceFor } from '../workspaces';

/**
 * Whose help the viewer works on: a platform admin the platform's articles and the corpus; a
 * Commission's administrator or reporting officer the Commission's (the session's tenant) and
 * its question themes. Null for anyone else.
 */
export interface HelpWorkspace {
  scope: HelpScope;
  /** Reporting officers read the Commission's articles; they do not edit them. */
  readOnly: boolean;
}

export function helpWorkspaceFor(
  roles: readonly string[],
  tenant: string | null,
): HelpWorkspace | null {
  if (workspaceFor(roles, 'platform-help')) {
    return { scope: { kind: 'platform' }, readOnly: false };
  }
  const commission = workspaceFor(roles, 'help');
  if (commission && tenant) {
    return { scope: { kind: 'commission', slug: tenant }, readOnly: commission.readOnly };
  }
  return null;
}

/**
 * What the help pages share while the viewer stays in them: the article published last, so the
 * help search drawer marks it "Just published", and the search it runs (the server function,
 * or a fake in tests).
 */
export interface HelpSession {
  justPublished: string | null;
  setJustPublished: (articleId: string | null) => void;
  searchAsDeclarants: SearchAsDeclarants;
  onUnauthenticated: () => void;
}

export const HelpSessionContext = createContext<HelpSession>({
  justPublished: null,
  setJustPublished: () => undefined,
  searchAsDeclarants: () =>
    Promise.resolve({ ok: false, error: { kind: 'unavailable', detail: null } }),
  onUnauthenticated: () => undefined,
});

export function useHelpSession(): HelpSession {
  return useContext(HelpSessionContext);
}
