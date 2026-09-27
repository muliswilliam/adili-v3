import { Button, Stepper, useToast } from '@adili/ui';
import { createFileRoute, Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { useEffect, useReducer, useRef } from 'react';

import { NoAccess } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { DiscardUploadDialog } from '../../components/roster/discard-upload-dialog';
import {
  canGoBackTo,
  holdsUpload,
  importStarted,
  initialWizardState,
  uploadInFlight,
  WIZARD_STEPS,
  type WizardStep,
  wizardReducer,
} from '../../components/roster/import-wizard';
import { messages as m } from '../../components/roster/messages';
import { putFile, type UploadDeps, uploadRosterFile } from '../../components/roster/upload';
import { WIZARD_TITLE_ID } from '../../components/roster/wizard-card';
import { WizardCheckStep } from '../../components/roster/wizard-check-step';
import { WizardTemplateStep } from '../../components/roster/wizard-template-step';
import { WizardUploadStep } from '../../components/roster/wizard-upload-step';
import { completeUpload, createRosterUpload } from '../../server/uploads';

export const Route = createFileRoute('/roster/import')({
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
  createUpload: (input) => createRosterUpload({ data: input }),
  putFile,
  completeUpload: (id) => completeUpload({ data: { id } }),
};

const RETURN_TO = '/roster/import';

/** Blocks every navigation while enabled; `disabled` switches it. Stable, so it registers once. */
const blockAll = () => true;

function ImportPage() {
  const { workspace } = Route.useRouteContext();
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
  return <ImportWizard />;
}

/**
 * The import wizard (spec 02): Template, Upload, Check, Import, Report. The file goes from the
 * browser straight to object storage through a presigned PUT; the console only reserves and
 * completes the upload. Leaving with an upload in flight or a clean file asks first.
 */
function ImportWizard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const upload = useRef<{ file: File; controller: AbortController } | null>(null);

  const holds = holdsUpload(state);
  const blocker = useBlocker({
    shouldBlockFn: blockAll,
    disabled: !holds,
    enableBeforeUnload: holds,
    withResolver: true,
  });

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
      if (outcome.kind === 'unauthenticated') {
        window.location.assign(`/auth/login?returnTo=${encodeURIComponent(RETURN_TO)}`);
      }
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
      ) : state.step === 'check' && state.upload.phase === 'clean' ? (
        <WizardCheckStep
          upload={state.upload.upload}
          onBack={() => {
            go('upload');
          }}
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
