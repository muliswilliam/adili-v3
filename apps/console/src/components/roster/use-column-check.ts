import { useEffect, useEffectEvent, useState } from 'react';

import type { DirectoryResult, RosterImport } from '../../server/directory/client';
import type { RosterUploadCheck } from '../../server/roster-imports';
import {
  checkFailure,
  defaultDeclaredComplete,
  needsNewIdempotencyKey,
  type StartFailure,
  startFailure,
} from './column-check';
import { runningImportId } from './import-report';
import type { CleanUpload } from './upload';
import type { ColumnCheckView } from './wizard-check-step';

export interface ColumnCheckDeps {
  check: (uploadId: string) => Promise<DirectoryResult<RosterUploadCheck>>;
  start: (input: {
    uploadId: string;
    declaredComplete: boolean;
    idempotencyKey: string;
  }) => Promise<DirectoryResult<RosterImport>>;
  findRunning: () => Promise<DirectoryResult<RosterImport | null>>;
  onUnauthenticated: () => void;
  onStarted: (imp: RosterImport) => void;
  onViewRunning: (importId: string) => void;
  /** The running import the officer asked for has already ended. */
  onRunningGone: () => void;
  /** The running import could not be looked up. */
  onRunningUnavailable: () => void;
  newIdempotencyKey?: () => string;
}

const unavailable = { ok: false, error: { kind: 'unavailable', detail: null } } as const;

/**
 * Step 3's calls: the column check of a clean upload, the "complete roster" choice with its
 * default, and starting the import with one Idempotency-Key per attempt that could have gone
 * through.
 */
export function useColumnCheck(upload: CleanUpload | null, deps: ColumnCheckDeps) {
  const newKey = deps.newIdempotencyKey ?? (() => crypto.randomUUID());
  const [round, setRound] = useState(0);
  // The check's answer and the start's refusal, for the upload and round they belong to;
  // anything else is stale (a check still loading), so a new upload or a retry needs no reset.
  const key = upload ? `${upload.id}:${String(round)}` : null;
  const [checked, setChecked] = useState<{ key: string; view: ColumnCheckView } | null>(null);
  // `running`: the import a 409 `import-in-progress` named, for "View progress".
  const [refused, setRefused] = useState<{
    key: string;
    failure: StartFailure;
    running: string | null;
  } | null>(null);
  const check: ColumnCheckView = checked?.key === key ? checked.view : { phase: 'loading' };
  const failure = refused?.key === key ? refused.failure : null;
  const [declaredComplete, setDeclaredComplete] = useState(false);
  const [starting, setStarting] = useState(false);
  // One Idempotency-Key per upload, kept while a start may have gone through unseen.
  const [idempotency, setIdempotency] = useState<{ uploadId: string; key: string } | null>(null);

  const runCheck = useEffectEvent((uploadId: string) => deps.check(uploadId));
  const unauthenticated = useEffectEvent(() => {
    deps.onUnauthenticated();
  });

  const uploadId = upload?.id ?? null;
  useEffect(() => {
    if (!uploadId || !key) return;
    let stopped = false;
    void runCheck(uploadId)
      .catch(() => unavailable)
      .then((result) => {
        if (stopped) return;
        if (result.ok) {
          const complete = defaultDeclaredComplete(result.data.roster);
          setDeclaredComplete(complete);
          setChecked({
            key,
            view: { phase: 'ready', preview: result.data.preview, defaulted: complete },
          });
        } else if (result.error.kind === 'unauthenticated') {
          unauthenticated();
        } else {
          setChecked({
            key,
            view: {
              phase: 'failed',
              failure: checkFailure(result.error),
              detail: result.error.kind === 'problem' ? result.error.problem.detail : undefined,
            },
          });
        }
      });
    return () => {
      stopped = true;
    };
  }, [uploadId, key]);

  const start = async () => {
    if (!uploadId || !key || starting) return;
    setStarting(true);
    setRefused(null);
    const idempotencyKey = idempotency?.uploadId === uploadId ? idempotency.key : newKey();
    setIdempotency({ uploadId, key: idempotencyKey });
    const result = await deps
      .start({ uploadId, declaredComplete, idempotencyKey })
      .catch(() => unavailable);
    setStarting(false);
    if (result.ok) {
      setIdempotency(null);
      deps.onStarted(result.data);
      return;
    }
    if (result.error.kind === 'unauthenticated') {
      deps.onUnauthenticated();
      return;
    }
    if (needsNewIdempotencyKey(result.error)) setIdempotency(null);
    setRefused({
      key,
      failure: startFailure(result.error),
      running: runningImportId(result.error),
    });
  };

  const viewRunning = async () => {
    const named = refused?.key === key ? refused.running : null;
    if (named) {
      deps.onViewRunning(named);
      return;
    }
    // An answer without the import's id: look it up among the newest imports.
    const result = await deps.findRunning().catch(() => unavailable);
    if (result.ok && result.data) {
      deps.onViewRunning(result.data.id);
    } else if (!result.ok && result.error.kind === 'unauthenticated') {
      deps.onUnauthenticated();
    } else if (result.ok) {
      setRefused(null);
      deps.onRunningGone();
    } else {
      deps.onRunningUnavailable();
    }
  };

  return {
    check,
    declaredComplete,
    setDeclaredComplete,
    starting,
    startFailure: failure,
    start,
    viewRunning,
    retryCheck: () => {
      setRound((current) => current + 1);
    },
  };
}
