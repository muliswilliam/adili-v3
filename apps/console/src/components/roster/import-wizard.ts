import type { CleanUpload, UploadOutcome } from './upload';

/**
 * The import wizard's state machine (spec 02: Template, Upload, Check, Import, Report). Pure, so
 * the rules are tested without a browser: going back is allowed until the import starts, an
 * upload's progress only counts for the attempt that is still current, and once an import has
 * started the wizard follows it to its report or failure.
 */

export const WIZARD_STEPS = ['template', 'upload', 'check', 'importing', 'report'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** The file being uploaded: what the step shows about it. */
export interface ChosenFile {
  name: string;
  size: number;
}

export type UploadState =
  | { phase: 'idle' }
  | { phase: 'requesting'; file: ChosenFile }
  | { phase: 'uploading'; file: ChosenFile; percent: number }
  | { phase: 'scanning'; file: ChosenFile }
  | { phase: 'clean'; file: ChosenFile; upload: CleanUpload }
  | { phase: 'infected'; file: ChosenFile }
  | { phase: 'rejected'; file: ChosenFile; reason: 'type' | 'size' }
  | { phase: 'failed'; file: ChosenFile };

export interface WizardState {
  step: WizardStep;
  upload: UploadState;
  /**
   * Counts upload attempts. Events carry the attempt they belong to, so a cancelled upload's
   * late progress or outcome cannot overwrite a newer one.
   */
  attempt: number;
  /** The import started from this wizard (or reopened from the URL), from step 4 on. */
  importId: string | null;
  /** Whether that import stopped with a failure; step 4 then shows why. */
  importFailed: boolean;
}

export type WizardAction =
  | { type: 'go'; step: WizardStep }
  | { type: 'start'; file: ChosenFile }
  | { type: 'uploading'; attempt: number }
  | { type: 'progress'; attempt: number; percent: number }
  | { type: 'scanning'; attempt: number }
  | { type: 'finished'; attempt: number; outcome: UploadOutcome }
  /** Drop the current upload (cancel, choose another file) and show the drop zone again. */
  | { type: 'reset' }
  /** The directory accepted the import of the clean upload. */
  | { type: 'started'; importId: string }
  /** The import being followed ended. */
  | { type: 'import-ended'; importId: string; outcome: 'completed' | 'failed' }
  /** After a report or a failed import: a new file, from the upload step. */
  | { type: 'import-another' }
  /** The followed import cannot be read (not the viewer's): start over from the template. */
  | { type: 'restart' }
  /** Follow another import, e.g. the one already running (its id put in the URL). */
  | { type: 'open'; importId: string };

export const initialWizardState: WizardState = {
  step: 'template',
  upload: { phase: 'idle' },
  attempt: 0,
  importId: null,
  importFailed: false,
};

/**
 * Where the wizard opens: at the template, or following an import already started (its id in
 * the URL), so a refresh or a return visit shows its progress again.
 */
export function wizardStateFor(importId: string | undefined): WizardState {
  return importId ? { ...initialWizardState, step: 'importing', importId } : initialWizardState;
}

const stepIndex = (step: WizardStep) => WIZARD_STEPS.indexOf(step);

/** Whether the import has started, after which the earlier steps are locked. */
export function importStarted(step: WizardStep): boolean {
  return stepIndex(step) >= stepIndex('importing');
}

/** Whether the upload step's file is on its way up or being scanned. */
export function uploadInFlight(
  upload: UploadState,
): upload is Extract<UploadState, { phase: 'requesting' | 'uploading' | 'scanning' }> {
  return (
    upload.phase === 'requesting' || upload.phase === 'uploading' || upload.phase === 'scanning'
  );
}

/**
 * Whether leaving the wizard would drop an upload the user has put effort into: one in flight,
 * or a clean one not imported yet (step 3). Leaving then asks "Discard this upload?".
 */
export function holdsUpload(state: WizardState): boolean {
  return (state.step === 'upload' && uploadInFlight(state.upload)) || state.step === 'check';
}

/** Whether the stepper may take the user back to `step`: a done step, before the import starts. */
export function canGoBackTo(state: WizardState, step: WizardStep): boolean {
  return !importStarted(state.step) && stepIndex(step) < stepIndex(state.step);
}

/** Whether `step` may be entered from where the wizard is. */
function canGo(state: WizardState, step: WizardStep): boolean {
  if (canGoBackTo(state, step)) return true;
  // Forward moves the user makes; the rest follow from the upload and the import.
  return state.step === 'template' && step === 'upload';
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'go': {
      if (!canGo(state, action.step)) return state;
      // Going back to the upload step or before starts over with a new file.
      const dropsUpload = stepIndex(action.step) <= stepIndex('upload');
      return {
        ...state,
        step: action.step,
        upload: dropsUpload ? { phase: 'idle' } : state.upload,
        attempt: dropsUpload && state.upload.phase !== 'idle' ? state.attempt + 1 : state.attempt,
      };
    }
    case 'start':
      if (state.step !== 'upload' || uploadInFlight(state.upload)) return state;
      return {
        ...state,
        upload: { phase: 'requesting', file: action.file },
        attempt: state.attempt + 1,
      };
    case 'reset':
      if (state.step !== 'upload') return state;
      return { ...state, upload: { phase: 'idle' }, attempt: state.attempt + 1 };
    case 'started':
      // Only a clean upload being checked can start an import.
      if (state.step !== 'check' || state.upload.phase !== 'clean') return state;
      return { ...state, step: 'importing', importId: action.importId, importFailed: false };
    case 'import-ended':
      if (state.step !== 'importing' || state.importId !== action.importId) return state;
      return action.outcome === 'completed'
        ? { ...state, step: 'report' }
        : { ...state, importFailed: true };
    case 'import-another':
      // From the report, or an import that stopped; a running import is left to finish.
      if (state.step !== 'report' && !(state.step === 'importing' && state.importFailed)) {
        return state;
      }
      return {
        ...initialWizardState,
        step: 'upload',
        attempt: state.attempt + 1,
      };
    case 'restart':
      if (!importStarted(state.step)) return state;
      return { ...initialWizardState, attempt: state.attempt + 1 };
    case 'open':
      if (state.importId === action.importId) return state;
      return { ...wizardStateFor(action.importId), attempt: state.attempt + 1 };
    default:
      return uploadEvent(state, action);
  }
}

/** Applies an event of the current upload attempt; events of older attempts are ignored. */
function uploadEvent(
  state: WizardState,
  action: Extract<WizardAction, { attempt: number }>,
): WizardState {
  const { upload } = state;
  if (action.attempt !== state.attempt || state.step !== 'upload' || !uploadInFlight(upload)) {
    return state;
  }
  const { file } = upload;
  switch (action.type) {
    case 'uploading':
      return { ...state, upload: { phase: 'uploading', file, percent: 0 } };
    case 'progress':
      return upload.phase === 'uploading'
        ? { ...state, upload: { ...upload, percent: Math.min(100, Math.max(0, action.percent)) } }
        : state;
    case 'scanning':
      return { ...state, upload: { phase: 'scanning', file } };
    case 'finished':
      return finish(state, file, action.outcome);
  }
}

function finish(state: WizardState, file: ChosenFile, outcome: UploadOutcome): WizardState {
  switch (outcome.kind) {
    case 'clean':
      // A clean file moves straight on to the check.
      return { ...state, step: 'check', upload: { phase: 'clean', file, upload: outcome.upload } };
    case 'infected':
      return { ...state, upload: { phase: 'infected', file } };
    case 'rejected':
      return { ...state, upload: { phase: 'rejected', file, reason: outcome.reason } };
    case 'failed':
      return { ...state, upload: { phase: 'failed', file } };
    // Signing in again or a cancel: the drop zone again, nothing to report.
    case 'unauthenticated':
    case 'aborted':
      return { ...state, upload: { phase: 'idle' } };
  }
}
