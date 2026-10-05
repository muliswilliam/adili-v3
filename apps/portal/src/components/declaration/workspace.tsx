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

import {
  getDeclaration,
  getDeclarationSection,
  saveDeclarationSection,
} from '../../server/declarations';
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
  sectionFreshness,
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
   * is used for the next save. `key` names the section it writes. See `AutosaveQueue.whileHeld`.
   */
  whileHeld: <T>(write: HeldWrite<T>, key?: SectionKey) => Promise<HeldResult<T>>;
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
  const whileHeld = useCallback(
    <T,>(write: HeldWrite<T>, key?: SectionKey) => queue.whileHeld(write, key),
    [queue],
  );
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
  /**
   * True while editing is off: after a conflict, until reload, and while the contents shown are
   * being read again because they were older than a save (see `sectionFreshness`).
   */
  disabled: boolean;
  /**
   * The service's issues for this section, from the load or the latest save, less those on an
   * answer changed since: the next save says whether it still has one. So answering a question
   * never flashes the old "unanswered" error on leaving it.
   */
  issues: CompletenessIssue[];
}

/** How long to wait before reading a stale section again after the read failed. */
const REREAD_MS = 2_000;

/**
 * State and autosave for one section screen. Give it the section as its route loaded it; edits
 * save after a 1.5 s pause, and leaving the screen sends them at once.
 *
 * A save sends the whole section with the draft's latest ETag, so the contents edited must be
 * at least as new as every save of the section (#700). The route's data can be older: a cached
 * or preloaded read, or one taken while this section's last edit was still on its way. So
 * before editing is turned on, the screen's contents are checked against the autosave queue,
 * and read again when a save landed after them. A newer read from the route (a loader re-run)
 * replaces them while this screen has no edit on its way.
 */
export function useSectionAutosave<T>(section: LoadedSection, etag: string): SectionAutosave<T> {
  const workspace = useWorkspace();
  const key = section.key;
  const { adoptEtag, flush, edit, setIssues, autosave } = workspace;
  const declarationId = workspace.declaration.id;
  // The read the contents come from: the route's, or a fresher one made here.
  const [source, setSource] = useState({ section, etag });
  const [value, setValue] = useState<T>(() => section.contents as T);
  const valueRef = useRef(value);
  const basis = source.section.draftVersion;
  const freshness = sectionFreshness(autosave, key, basis);
  // Editing starts once the contents are known to be fresh, and stays on: from then on the
  // section's saves are this screen's own.
  const [checked, setChecked] = useState(freshness === 'fresh');
  if (!checked && freshness === 'fresh') {
    setChecked(true);
  }
  const editable = checked || freshness === 'fresh';
  const editableRef = useRef(editable);
  useEffect(() => {
    editableRef.current = editable;
    valueRef.current = value;
  }, [editable, value]);
  const [attempt, setAttempt] = useState(0);

  const reseed = useCallback((next: LoadedSection, nextEtag: string) => {
    setSource({ section: next, etag: nextEtag });
    setValue(next.contents as T);
    setChecked(false);
  }, []);

  // A newer read from the route, e.g. a loader re-run: take it unless an edit is on its way.
  const [routeSection, setRouteSection] = useState(section);
  if (routeSection !== section) {
    setRouteSection(section);
    const waiting = key in autosave.pending || autosave.inFlight?.key === key;
    if (section.draftVersion > basis && !waiting && autosave.rejection?.key !== key) {
      reseed(section, etag);
    }
  }

  // Contents older than a save of this section: read it again once that save has landed.
  const stale = !checked && freshness === 'stale';
  useEffect(() => {
    if (!stale) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    void getDeclarationSection({ data: { declarationId, sectionKey: key } })
      .catch(() => null)
      .then((result) => {
        if (cancelled) return;
        if (result?.status === 'ok') {
          reseed(result.section, result.etag);
          return;
        }
        retry = setTimeout(() => {
          setAttempt((current) => current + 1);
        }, REREAD_MS);
      });
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [stale, basis, declarationId, key, reseed, attempt]);

  // On each read only; later issues come from saves.
  useEffect(() => {
    adoptEtag(source.etag, source.section.draftVersion);
    setIssues(key, source.section.issues, source.section.contents);
  }, [adoptEtag, setIssues, key, source]);

  // Leaving the screen sends its waiting edits at once.
  useEffect(
    () => () => {
      flush(key);
    },
    [flush, key],
  );

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      // Never save contents that may be older than a save of the section.
      if (!editableRef.current) return;
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
    disabled: workspace.conflict || !editable,
    issues: current(
      workspace.issues[key] ?? source.section.issues,
      key in workspace.issueBasis ? workspace.issueBasis[key] : source.section.contents,
      value,
    ),
  };
}

/** The issues whose answer is as it was in `basis`, the contents they were found in. */
function current(issues: CompletenessIssue[], basis: unknown, value: unknown) {
  if (basis === value) return issues;
  return issues.filter((issue) => issue.path === '' || sameAt(basis, value, issue.path));
}
