import { Button, Stepper, useToast } from '@adili/ui';
import { createFileRoute, Link, useBlocker, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react';
import { z } from 'zod';

import { LoadError, NoAccess } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { DiscardUploadDialog } from '../../components/roster/discard-upload-dialog';
import {
  canGoBackTo,
  holdsUpload,
  importStarted,
  uploadInFlight,
  WIZARD_STEPS,
  type WizardStep,
  wizardReducer,
  wizardStateFor,
} from '../../components/roster/import-wizard';
import { messages as m } from '../../components/roster/messages';
import { putFile, type UploadDeps, uploadRosterFile } from '../../components/roster/upload';
import { useColumnCheck } from '../../components/roster/use-column-check';
import { useImportPolling } from '../../components/roster/use-import-polling';
import { WIZARD_TITLE_ID } from '../../components/roster/wizard-card';
import { WizardCheckStep } from '../../components/roster/wizard-check-step';
import { ImportUnavailable, WizardImportStep } from '../../components/roster/wizard-import-step';
import { WizardReportStep } from '../../components/roster/wizard-report-step';
import { WizardTemplateStep } from '../../components/roster/wizard-template-step';
import { WizardUploadStep } from '../../components/roster/wizard-upload-step';
import { goToSignIn } from '../../components/sign-in-redirect';
import type { RosterImport } from '../../server/directory/client';
import {
  checkRosterUpload,
  findRunningRosterImport,
  getRosterImport,
  listRejectedRows,
  startRosterImport,
} from '../../server/roster-imports';
import { completeUpload, createRosterUpload } from '../../server/uploads';

/**
 * `import`: the import this wizard follows from step 4 on, so a refresh, a return visit or a
 * shared link shows its progress and report again.
 */
const importSearch = z.object({ import: z.uuid().optional().catch(undefined) });

export const Route = createFileRoute('/roster/import')({
  validateSearch: importSearch,
  head: () => ({ meta: [{ title: `${m.importTitle} · Adili Online Console` }] }),
  staticData: { crumb: m.importTitle },
  component: ImportPage,
});

const STEP_LABELS: Record<WizardStep, string> = {
  template: m.stepTemplate,
  upload: m.stepUpload,
  check: m.stepCheck,
  importing: m.stepImport,
  report: m.stepReport,
};
const STEPS = WIZARD_STEPS.map((id) => ({ id, label: STEP_LABELS[id] }));

const isStep = (id: string): id is WizardStep => WIZARD_STEPS.some((step) => step === id);

const uploadDeps: UploadDeps = {
  createUpload: (input, idempotencyKey) =>
    createRosterUpload({ data: { ...input, idempotencyKey } }),
  putFile,
  completeUpload: (id, idempotencyKey) => completeUpload({ data: { id, idempotencyKey } }),
};

const returnTo = (importId: string | null) =>
  importId ? `/roster/import?import=${importId}` : '/roster/import';

const signIn = (importId: string | null) => {
  goToSignIn(returnTo(importId));
};

/** Blocks every navigation while enabled; `disabled` switches it. Stable, so it registers once. */
const blockAll = () => true;

function ImportPage() {
  const { workspace, tenant } = Route.useRouteContext();
  // The layout shows why there is no workspace.
  if (!workspace) return null;
  if (workspace.readOnly) {
    return (
      <Page narrow>
        <PageHead title={m.importTitle} />
        <NoAccess
          text={m.importReadOnly}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/roster">{m.backToRoster}</Link>
            </Button>
          }
        />
      </Page>
    );
  }
  // A reporting officer without a tenant: a broken account, shown as a failed load.
  if (!tenant) {
    return (
      <Page narrow>
        <PageHead title={m.importTitle} />
        <LoadError title={m.errorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
      </Page>
    );
  }
  return <ImportWizard slug={tenant} />;
}

/**
 * The import wizard (spec 02): Template, Upload, Check, Import, Report. The file goes from the
 * browser straight to object storage through a presigned PUT; the console only reserves and
 * completes the upload. Leaving with an upload in flight or a clean file asks first. Once the
 * import starts its id goes in the URL, the earlier steps lock, and the officer may leave.
 */
function ImportWizard({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { toast } = useToast();
  const search = Route.useSearch();
  const [state, dispatch] = useReducer(wizardReducer, search.import, wizardStateFor);
  const upload = useRef<{ file: File; controller: AbortController } | null>(null);
  // The start's answer, shown until the first poll comes back.
  const [started, setStarted] = useState<RosterImport | null>(null);

  const holds = holdsUpload(state);
  const blocker = useBlocker({
    shouldBlockFn: blockAll,
    disabled: !holds,
    enableBeforeUnload: holds,
    withResolver: true,
  });

  // The URL follows the import the wizard follows (replacing the entry, so Back leaves the
  // wizard), and a URL naming another import (e.g. "View progress") makes the wizard follow it.
  const urlImport = search.import ?? null;
  const followUrl = useEffectEvent((importId: string | null) => {
    if (importId && importId !== state.importId) dispatch({ type: 'open', importId });
  });
  useEffect(() => {
    followUrl(urlImport);
  }, [urlImport]);
  const updateUrl = useEffectEvent((importId: string | null) => {
    if (importId === urlImport) return;
    void navigate({
      to: '/roster/import',
      search: importId ? { import: importId } : {},
      replace: true,
    });
  });
  useEffect(() => {
    updateUrl(state.importId);
  }, [state.importId]);

  const stopUpload = () => {
    upload.current?.controller.abort();
    upload.current = null;
  };
  // Leaving the page stops the PUT; an upload left behind expires on the documents side.
  useEffect(() => stopUpload, []);

  // A new step starts at the top of the page, with its heading focused so keyboard and screen
  // reader users start there too. Focusing alone would scroll the heading under the sticky bar.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    document.getElementById(WIZARD_TITLE_ID)?.focus({ preventScroll: true });
  }, [state.step]);

  const cleanUpload =
    state.step === 'check' && state.upload.phase === 'clean' ? state.upload : null;
  const columnCheck = useColumnCheck(cleanUpload?.upload ?? null, {
    check: (uploadId) => checkRosterUpload({ data: { slug, uploadId } }),
    start: (input) => startRosterImport({ data: { slug, ...input } }),
    findRunning: () => findRunningRosterImport({ data: { slug } }),
    onUnauthenticated: () => {
      signIn(null);
    },
    onStarted: (imp) => {
      setStarted(imp);
      dispatch({ type: 'started', importId: imp.id });
    },
    onViewRunning: (importId) => {
      void navigate({ to: '/roster/import', search: { import: importId } });
    },
    onRunningGone: () => {
      toast({ title: m.runningGone });
    },
    onRunningUnavailable: () => {
      toast({ title: m.runningUnavailable });
    },
  });

  const following = importStarted(state.step) ? state.importId : null;
  const polling = useImportPolling(following, {
    read: (importId) => getRosterImport({ data: { slug, importId } }),
    onUnauthenticated: () => {
      signIn(following);
    },
    onEnded: (imp) => {
      // The layout's roster summary (the sidebar's flagged count) changed with the import.
      void router.invalidate({ filter: (match) => match.routeId === '/roster' });
      dispatch({
        type: 'import-ended',
        importId: imp.id,
        outcome: imp.state === 'completed' ? 'completed' : 'failed',
      });
    },
  });
  const imp = polling.imp ?? (started?.id === following ? started : null);

  const start = (file: File) => {
    if (state.step !== 'upload' || uploadInFlight(state.upload)) return;
    stopUpload();
    const controller = new AbortController();
    upload.current = { file, controller };
    // The reducer numbers this attempt one past the current one.
    const attempt = state.attempt + 1;
    dispatch({ type: 'start', file: { name: file.name, size: file.size } });
    void uploadRosterFile(file, uploadDeps, {
      signal: controller.signal,
      onUploading: () => {
        dispatch({ type: 'uploading', attempt });
      },
      onProgress: (percent) => {
        dispatch({ type: 'progress', attempt, percent });
      },
      onScanning: () => {
        dispatch({ type: 'scanning', attempt });
      },
    }).then((outcome) => {
      if (outcome.kind === 'unauthenticated') signIn(null);
      dispatch({ type: 'finished', attempt, outcome });
    });
  };

  const go = (step: WizardStep) => {
    if (step === 'upload' || step === 'template') stopUpload();
    dispatch({ type: 'go', step });
  };

  const reset = () => {
    stopUpload();
    dispatch({ type: 'reset' });
  };

  const retry = () => {
    const file = upload.current?.file;
    if (file) start(file);
  };

  const importAnother = () => {
    stopUpload();
    setStarted(null);
    dispatch({ type: 'import-another' });
  };

  const discard = () => {
    stopUpload();
    blocker.proceed?.();
    toast({ title: m.uploadDiscarded });
  };

  return (
    <Page narrow>
      <PageHead
        title={m.importTitle}
        actions={
          importStarted(state.step) ? null : (
            <Button variant="ghost" onClick={() => void navigate({ to: '/roster' })}>
              {m.cancel}
            </Button>
          )
        }
      />
      <Stepper
        label={m.importSteps}
        steps={STEPS}
        current={state.step}
        failed={state.step === 'importing' && state.importFailed}
        onSelect={(id) => {
          if (isStep(id)) go(id);
        }}
        canSelect={(id) => isStep(id) && canGoBackTo(state, id)}
      />
      {state.step === 'template' ? (
        <WizardTemplateStep
          onNext={() => {
            go('upload');
          }}
        />
      ) : state.step === 'upload' ? (
        <WizardUploadStep
          upload={state.upload}
          onFile={start}
          onCancel={reset}
          onRetry={retry}
          onChooseAnother={reset}
          onBack={() => {
            go('template');
          }}
        />
      ) : cleanUpload ? (
        <WizardCheckStep
          upload={cleanUpload.upload}
          check={columnCheck.check}
          declaredComplete={columnCheck.declaredComplete}
          onDeclaredCompleteChange={columnCheck.setDeclaredComplete}
          starting={columnCheck.starting}
          startFailure={columnCheck.startFailure}
          onStart={() => void columnCheck.start()}
          onRetryCheck={columnCheck.retryCheck}
          onViewRunning={() => void columnCheck.viewRunning()}
          onBack={() => {
            go('upload');
          }}
        />
      ) : polling.error ? (
        <ImportUnavailable
          notFound={polling.error === 'not-found'}
          onRetry={polling.retry}
          onStartNew={() => {
            dispatch({ type: 'restart' });
          }}
        />
      ) : state.step === 'report' && imp ? (
        <WizardReportStep
          imp={imp}
          readRows={(cursor) => listRejectedRows({ data: { slug, importId: imp.id, cursor } })}
          returnTo={returnTo(imp.id)}
          onImportAnother={importAnother}
        />
      ) : state.step === 'importing' ? (
        <WizardImportStep
          imp={imp}
          fileSize={state.upload.phase === 'clean' ? state.upload.file.size : undefined}
          reconnecting={polling.reconnecting}
          onImportAnother={importAnother}
        />
      ) : null}
      <DiscardUploadDialog
        open={blocker.status === 'blocked'}
        onKeep={() => blocker.reset?.()}
        onDiscard={discard}
      />
    </Page>
  );
}
