import { useRouter } from '@tanstack/react-router';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { getDeclaration, saveDeclarationSection } from '../../server/declarations';
import type { LoadedSection, SaveOutcome } from '../../server/declarations.server';
import type {
  CompletenessIssue,
  Declaration,
  SectionKey,
  SectionSaveResult,
} from '../../server/declarations/types';
import {
  type AutosaveState,
  AutosaveQueue,
  hasUnsavedWork,
  type HeldResult,
  type HeldWrite,
} from './autosave';
import type { Draft, Household } from '../../declaration/contents';
import { renamesPerson } from '../../declaration/household';
import { signInAgain } from '../sign-in';
import { sameAt } from './section-errors';

/**
 * The declaration workspace's shared state: the draft's header and section completeness, the
 * one autosave queue for the whole draft (its ETag covers every section), and the latest
 * completeness issues per section. Sections use `useSectionAutosave`; the layout reads the
 * rest with `useWorkspace`.
 */
export interface WorkspaceValue {
  declaration: Declaration;
  autosave: AutosaveState;
  /** Editing is off after a 412 until the declarant reloads. */
  conflict: boolean;
  /** Latest issues per section, from a save or a fresh load. */
  issues: Partial<Record<SectionKey, CompletenessIssue[]>>;
  /** The contents each section's `issues` were found in: the saved or loaded contents. */
  issueBasis: Partial<Record<SectionKey, unknown>>;
  edit: (key: SectionKey, contents: unknown) => void;
  flush: (key?: SectionKey) => void;
  /** Takes a freshly read ETag when it is newer than the queue's (e.g. after an attachment). */
  adoptEtag: (etag: string, version: number) => void;
  /**
   * Runs a write the service makes to the draft outside autosave (linking or unlinking a
   * document): waiting edits are sent first, saves wait while it runs, and the ETag it read back
   * is used for the next save. See `AutosaveQueue.whileHeld`.
   */
  whileHeld: <T>(write: HeldWrite<T>) => Promise<HeldResult<T>>;
  setIssues: (key: SectionKey, issues: CompletenessIssue[], basis: unknown) => void;
  /** Re-reads the header and section list, e.g. after a household save changed statements. */
  refresh: () => Promise<void>;
  /** After a conflict: reloads the draft and every loader, then lets editing resume. */
  reload: () => Promise<void>;
  /** Changes on every reload, so section screens remount with the reloaded contents. */
  generation: number;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside a WorkspaceProvider');
  return value;
}

async function save(
  declarationId: string,
  sectionKey: SectionKey,
  contents: unknown,
  ifMatch: string,
  onSignedOut: () => void,
): Promise<SaveOutcome> {
  const outcome = await saveDeclarationSection({
    data: {
      declarationId,
      sectionKey,
      ifMatch,
      contents: contents as Record<string, unknown>,
    },
  });
  if (outcome.status !== 'unauthenticated') return outcome;
  // The edit stays queued and is retried like an outage while the declarant signs in.
  onSignedOut();
  return { status: 'unavailable' };
}

function withSaveResult(declaration: Declaration, result: SectionSaveResult): Declaration {
  return {
    ...declaration,
    draftVersion: result.draftVersion,
    lastSection: result.key,
    sections: declaration.sections.map((section) =>
      section.key === result.key
        ? { ...section, completeness: result.completeness, updatedAt: new Date().toISOString() }
        : section,
    ),
  };
}

export interface WorkspaceProviderProps {
  declaration: Declaration;
  etag: string;
  children: ReactNode;
}

export function WorkspaceProvider({ declaration: loaded, etag, children }: WorkspaceProviderProps) {
  const router = useRouter();
  const [declaration, setDeclaration] = useState(loaded);
  const [issues, setIssueMap] = useState<WorkspaceValue['issues']>({});
  const [issueBasis, setIssueBasis] = useState<WorkspaceValue['issueBasis']>({});
  const [generation, setGeneration] = useState(0);
  const declarationId = loaded.id;

  // A loader re-ran (navigation or reload): take its header, and its ETag when newer.
  const [seen, setSeen] = useState(loaded);
  if (seen !== loaded) {
    setSeen(loaded);
    setDeclaration(loaded);
  }

  const [queue] = useState(() => {
    let signingIn = false;
    // The session ended mid-edit: sign in and come back here. Once only, so a declarant who
    // stays (the page warns about the unsaved edit) is not sent again on every retry.
    const signIn = () => {
      if (signingIn) return;
      signingIn = true;
      signInAgain();
    };
    return new AutosaveQueue({
      etag,
      version: loaded.draftVersion,
      save: (key, contents, ifMatch) => save(declarationId, key, contents, ifMatch, signIn),
    });
  });

  const refresh = useCallback(async () => {
    const result = await getDeclaration({ data: { declarationId } });
    if (result.status === 'ok') {
      setDeclaration(result.declaration);
      queue.adoptEtag(result.etag, result.declaration.draftVersion);
    }
  }, [declarationId, queue]);

  useEffect(() => {
    queue.setOnSaved((key, result, contents) => {
      setDeclaration((current) => withSaveResult(current, result));
      setIssueMap((current) => ({ ...current, [key]: result.issues }));
      setIssueBasis((current) => ({ ...current, [key]: contents }));
      const renamed =
        key === 'household' &&
        renamesPerson(
          declaration.sections,
          contents as Draft<Household>,
          declaration.statementDate,
        );
      if (result.sectionsChanged.length > 0 || renamed) void refresh();
    });
  }, [queue, refresh, declaration]);

  useEffect(() => {
    queue.adoptEtag(etag, loaded.draftVersion);
  }, [queue, etag, loaded.draftVersion]);

  useEffect(
    () => () => {
      queue.dispose();
    },
    [queue],
  );

  const autosave = useSyncExternalStore(queue.subscribe, queue.getState, queue.getState);

  // Before the tab closes, send waiting edits at once, then ask to confirm only if a save is
  // still in flight or waiting (or was refused). Never while the page shows Saved.
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      queue.flush();
      if (hasUnsavedWork(queue.getState())) event.preventDefault();
    }
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [queue]);

  const reload = useCallback(async () => {
    const result = await getDeclaration({ data: { declarationId } });
    if (result.status !== 'ok') return;
    queue.reset(result.etag, result.declaration.draftVersion);
    setDeclaration(result.declaration);
    setIssueMap({});
    setIssueBasis({});
    await router.invalidate();
    setGeneration((current) => current + 1);
  }, [declarationId, queue, router]);

  const edit = useCallback(
    (key: SectionKey, contents: unknown) => {
      queue.edit(key, contents);
    },
    [queue],
  );
  const flush = useCallback(
    (key?: SectionKey) => {
      queue.flush(key);
    },
    [queue],
  );
  const adoptEtag = useCallback(
    (nextEtag: string, version: number) => {
      queue.adoptEtag(nextEtag, version);
    },
    [queue],
  );
  const whileHeld = useCallback(<T,>(write: HeldWrite<T>) => queue.whileHeld(write), [queue]);
  const setIssues = useCallback((key: SectionKey, next: CompletenessIssue[], basis: unknown) => {
    setIssueMap((current) => ({ ...current, [key]: next }));
    setIssueBasis((current) => ({ ...current, [key]: basis }));
  }, []);

  const value: WorkspaceValue = {
    declaration,
    autosave,
    conflict: autosave.status === 'conflict',
    issues,
    issueBasis,
    edit,
    flush,
    adoptEtag,
    whileHeld,
    setIssues,
    refresh,
    reload,
    generation,
  };

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>;
}

export interface SectionAutosave<T> {
  /** The section's contents as the declarant has edited them. */
  value: T;
  /** Replaces the contents (or derives them from the current ones) and schedules a save. */
  update: (next: T | ((current: T) => T)) => void;
  /** True while editing is off (after a conflict, until reload). */
  disabled: boolean;
  /**
   * The service's issues for this section, from the load or the latest save, less those on an
   * answer changed since: the next save says whether it still has one. So answering a question
   * never flashes the old "unanswered" error on leaving it.
   */
  issues: CompletenessIssue[];
}

/**
 * State and autosave for one section screen. Give it the section as its route loaded it
 * (always fresh); edits save after a 1.5 s pause, and leaving the screen sends them at once.
 */
export function useSectionAutosave<T>(section: LoadedSection, etag: string): SectionAutosave<T> {
  const workspace = useWorkspace();
  const key = section.key;
  const [value, setValue] = useState<T>(() => section.contents as T);
  const valueRef = useRef(value);
  const { adoptEtag, flush, edit, setIssues } = workspace;

  // On load only; later issues come from saves.
  useEffect(() => {
    adoptEtag(etag, section.draftVersion);
    setIssues(key, section.issues, section.contents);
  }, [adoptEtag, setIssues, etag, key, section]);

  // Leaving the screen sends its waiting edits at once.
  useEffect(
    () => () => {
      flush(key);
    },
    [flush, key],
  );

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      const resolved =
        typeof next === 'function' ? (next as (current: T) => T)(valueRef.current) : next;
      valueRef.current = resolved;
      setValue(resolved);
      edit(key, resolved);
    },
    [edit, key],
  );

  return {
    value,
    update,
    disabled: workspace.conflict,
    issues: current(
      workspace.issues[key] ?? section.issues,
      key in workspace.issueBasis ? workspace.issueBasis[key] : section.contents,
      value,
    ),
  };
}

/** The issues whose answer is as it was in `basis`, the contents they were found in. */
function current(issues: CompletenessIssue[], basis: unknown, value: unknown) {
  if (basis === value) return issues;
  return issues.filter((issue) => issue.path === '' || sameAt(basis, value, issue.path));
}
