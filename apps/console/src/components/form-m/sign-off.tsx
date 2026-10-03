import {
  AutosaveFailure,
  Button,
  type FormMDeclarationSectionKey,
  Icon,
  useAutosave,
} from '@adili/ui';
import { SecurityCheckIcon, UserCheck01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { FormMResult, FormMWorkspace } from '../../server/form-m.server';
import type {
  ConfirmOutcome,
  DocumentLink,
  ManualFields,
  Remarks,
} from '../../server/form-m-sign-off.server';
import { refusalOf } from '../../server/reporting/refusals';
import type { ComplianceReport } from '../../server/reporting/types';
import { confirmReducer, dialogOpen, initialConfirmState, type StepUpMarker } from './confirm';
import {
  type CompiledReport,
  type FormMReportExtensions,
  FormMWorkspaceView,
  type FormMWorkspaceViewProps,
} from './form-m-workspace';
import { manualMissing } from './form-m-view';
import { emailTakes } from './manual-fields';
import { messages as fm } from './messages';
import {
  ConfirmDialog,
  MarkReviewedDialog,
  RefusedBanner,
  StepUpFailedBanner,
} from './sign-off-dialogs';
import { messages as m, saveRefusedCopy } from './sign-off-messages';
import { ComplaintsForm, PartIForm, type PartBValues, type PartIValues } from './sign-off-parts';
import { SubmittedHeader } from './submitted-header';

/** The reporting service's sign-off calls for the signed-in officer, by financial year. */
export interface SignOffActions {
  saveRemarks: (fy: number, remarks: Remarks) => Promise<FormMResult<null>>;
  saveManualFields: (fy: number, fields: ManualFields) => Promise<FormMResult<null>>;
  markReviewed: (fy: number, designation: string) => Promise<FormMResult<null>>;
  confirm: (fy: number, idempotencyKey: string) => Promise<ConfirmOutcome>;
  /** Whether the session holds a fresh step-up; null when it could not be read. */
  stepUpFresh: () => Promise<boolean | null>;
  documentLink: (documentId: string) => Promise<FormMResult<DocumentLink>>;
}

/** Leaving the page: the step-up, signing in again, a download, and dropping `?stepUp=`. */
export interface SignOffNavigation {
  stepUp: (returnTo: string) => void;
  signIn: (returnTo: string) => void;
  download: (url: string) => void;
  clearStepUpMarker: () => void;
}

export interface FormMSignOffViewProps extends Omit<
  FormMWorkspaceViewProps,
  'result' | 'extensions'
> {
  result: FormMResult<FormMWorkspace>;
  /** The signed-in officer's name, for "Compiled by" and "Confirmed by". */
  viewerName: string;
  /** Set when the page was opened on the way back from a step-up (`?stepUp=`). */
  stepUpMarker: StepUpMarker | null;
  actions: SignOffActions;
  navigation: SignOffNavigation;
}

/** What the officer changed this visit, over the report as loaded (kept by the service too). */
interface Edits {
  /** By obligation id, across sections 1-3: the running map the remarks autosave sends. */
  remarks: Record<string, string>;
  partI: Partial<PartIValues>;
  partB: PartBValues | null;
}

const NO_EDITS: Edits = { remarks: {}, partI: {}, partB: null };

/** Remarks, Part I and Part B can be edited: a compiled draft, reviewed or not, not yet submitted. */
const editable = (report: ComplianceReport) =>
  report.document !== null && (report.status === 'draft' || report.status === 'reviewed');

/** The obligation ids of the non-filers sections 1-3 of the report's draft list. */
function listedObligations(report: ComplianceReport | null): Set<string> {
  const partII = report?.document?.partII;
  if (!partII) return new Set();
  return new Set(
    [partII.initial, partII.biennial, partII.final].flatMap((section) =>
      section.nonFilers.flatMap((row) => (row.obligationId ? [row.obligationId] : [])),
    ),
  );
}

/** The report with this visit's edits laid over its document, as the service now holds it. */
function withEdits(report: ComplianceReport, edits: Edits): ComplianceReport {
  const { document } = report;
  if (!document || !editable(report)) return report;
  const { partII } = document;
  const remarked = (key: FormMDeclarationSectionKey) => ({
    ...partII[key],
    nonFilers: partII[key].nonFilers.map((row) => {
      const remark = row.obligationId ? edits.remarks[row.obligationId] : undefined;
      return remark === undefined ? row : { ...row, remarks: remark };
    }),
  });
  return {
    ...report,
    document: {
      ...document,
      partI: { ...document.partI, ...edits.partI },
      partII: {
        ...partII,
        initial: remarked('initial'),
        biennial: remarked('biennial'),
        final: remarked('final'),
        complaints: edits.partB ?? partII.complaints,
      },
    },
  };
}

/**
 * Throws unless the save went through, as `useAutosave` reads it: a refusal for good stops the
 * autosave (`AutosaveFailure`), anything else is retried with backoff. A session that ended
 * calls `onSignedOut` (sign in again) and stops.
 */
function throwUnlessSaved(result: FormMResult<null>, onSignedOut: () => void): void {
  if (result.ok) return;
  const { error } = result;
  if (error.kind === 'unauthenticated') {
    onSignedOut();
    throw new AutosaveFailure('error', 'unauthenticated');
  }
  // The network or a 5xx: passing, so retry.
  if (error.kind === 'unavailable') throw new Error('unavailable');
  const refusal = refusalOf(error.problem);
  // A recompile running: passing too.
  if (refusal === 'compiling') throw new Error(refusal);
  // The message is the refusal, for the indicator's copy (`saveRefusedCopy`).
  throw new AutosaveFailure('error', refusal);
}

/** Part I as the service takes it: blanks clear a field; an email address it would refuse waits. */
function partIFields(values: PartIValues): ManualFields {
  const text = (value: string) => value.trim() || null;
  return {
    contactDetails: text(values.contactDetails),
    physicalAddress: text(values.physicalAddress),
    ...(emailTakes(values.emailAddress) ? { emailAddress: text(values.emailAddress) } : {}),
  };
}

const PENDING = new Set(['saving', 'retrying']);
/** A save the service refused, or one overtaken elsewhere: what is shown is not what it holds. */
const STOPPED = new Set(['error', 'conflict']);

/**
 * The Idempotency-Key of a confirmation whose outcome is not known yet (no answer, a 5xx), kept
 * in the tab's session storage by report: the step-up leaves the page, and confirming again
 * after it must send the same key, so the service answers the first attempt rather than file
 * twice. Dropped once an attempt has a known outcome.
 */
const pendingKeys = {
  name: (reportId: string) => `adili:form-m-confirm-key:${reportId}`,
  get(reportId: string): string | null {
    try {
      return window.sessionStorage.getItem(this.name(reportId));
    } catch {
      return null;
    }
  },
  set(reportId: string, key: string) {
    try {
      window.sessionStorage.setItem(this.name(reportId), key);
    } catch {
      // No storage (private mode): the key lives as long as the dialog.
    }
  },
  clear(reportId: string) {
    try {
      window.sessionStorage.removeItem(this.name(reportId));
    } catch {
      // As above.
    }
  },
};

/**
 * The Form M workspace with its sign-off (spec 09 FE-2 second half, #226), plugged into the
 * workspace's extensions (#223): the supervisor edits remarks (autosaved) and marks the draft
 * reviewed; the commission-admin fills Part I and Part B (autosaved) and confirms and submits
 * after a fresh step-up; a submitted report shows its reference, receipt and downloads. Render
 * it keyed by financial year, so edits and a confirmation in progress belong to their year.
 */
export function FormMSignOffView({
  result,
  capabilities,
  viewerName,
  stepUpMarker,
  actions,
  navigation,
  ...props
}: FormMSignOffViewProps) {
  const router = useRouter();
  const data = result.ok ? result.data : null;
  const fy = data?.fy ?? 0;
  const today = data?.today ?? '';
  const loaded = data?.report ?? null;
  const [edits, setEdits] = useState<Edits>(NO_EDITS);
  // The edits as of the latest change, ahead of the render: each save sends the newest map.
  const latestEdits = useRef<Edits>(NO_EDITS);
  const updateEdits = (change: (current: Edits) => Edits): Edits => {
    const next = change(latestEdits.current);
    latestEdits.current = next;
    setEdits(next);
    return next;
  };
  const [reviewing, setReviewing] = useState(false);
  const [state, dispatch] = useReducer(confirmReducer, initialConfirmState);
  const returnTo = `/form-m?fy=${String(fy)}`;

  const signIn = useCallback(() => {
    navigation.signIn(returnTo);
  }, [navigation, returnTo]);

  // One autosave per report for sections 1-3 (#496's FormMSection API): it sends the running
  // obligation id to remark map of every edit, so no save drops another section's.
  const remarksSave = useAutosave<Remarks>(
    useCallback(
      async (remarks) => {
        throwUnlessSaved(await actions.saveRemarks(fy, remarks), signIn);
      },
      [actions, fy, signIn],
    ),
  );
  const partISave = useAutosave<PartIValues>(
    useCallback(
      async (values) => {
        throwUnlessSaved(await actions.saveManualFields(fy, partIFields(values)), signIn);
      },
      [actions, fy, signIn],
    ),
  );
  const partBSave = useAutosave<PartBValues>(
    useCallback(
      async ({ registerMaintained, items }) => {
        throwUnlessSaved(
          await actions.saveManualFields(fy, {
            complaintsRegisterMaintained: registerMaintained,
            complaints: items,
          }),
          signIn,
        );
      },
      [actions, fy, signIn],
    ),
    { delayMs: 0 },
  );

  const report = loaded ? withEdits(loaded, edits) : null;
  const document = report?.document ?? null;
  const missing = document ? manualMissing(document) : [];
  const manualSaves = [partISave, partBSave];
  const saving = manualSaves.some((save) => PENDING.has(save.status));
  const unsaved = manualSaves.some((save) => STOPPED.has(save.status));
  const ready =
    capabilities.signsOff &&
    report?.status === 'reviewed' &&
    missing.length === 0 &&
    !saving &&
    !unsaved;
  const reportId = report?.id ?? '';
  const remarksRefused = saveRefusedCopy(remarksSave.failure);

  // Back from the step-up: drop the marker, so a reload does not reopen the dialog. A failed one
  // says so; one that went through opens the dialog if the session holds a fresh step-up and the
  // report can still be confirmed (else it changed meanwhile, and the page shows how it stands).
  const handled = useRef(false);
  useEffect(() => {
    if (!stepUpMarker || handled.current) return;
    handled.current = true;
    navigation.clearStepUpMarker();
    if (stepUpMarker === 'done' && !ready) return;
    const fresh = stepUpMarker === 'done' ? actions.stepUpFresh() : Promise.resolve(false);
    void fresh
      .catch(() => null)
      .then((isFresh) => {
        dispatch({
          type: 'step-up-returned',
          confirmed: isFresh === true,
          key: pendingKeys.get(reportId) ?? crypto.randomUUID(),
        });
      });
  }, [stepUpMarker, ready, actions, navigation, reportId]);

  useEffect(() => {
    if (state.step === 'stepping-up') navigation.stepUp(returnTo);
    if (state.step === 'signed-out') signIn();
    if (state.step === 'submitted' || state.step === 'refused') void router.invalidate();
  }, [state.step, navigation, returnTo, router, signIn]);

  const confirm = () => {
    if (state.step !== 'confirm' || !state.checked) return;
    const { key } = state;
    dispatch({ type: 'submit-pressed' });
    pendingKeys.set(reportId, key);
    void actions
      .confirm(fy, key)
      .catch((): ConfirmOutcome => ({ status: 'unavailable' }))
      .then((answer) => {
        if (answer.status !== 'unavailable' && answer.status !== 'busy') {
          pendingKeys.clear(reportId);
        }
        dispatch({ type: 'answered', answer });
      });
  };

  const extensions: FormMReportExtensions = {
    sectionProps: (section, shown) =>
      capabilities.reviews && editable(shown)
        ? {
            // Said where remarks were edited, rather than in every section at once.
            ...(sectionEdited(shown, section) ? { autosave: remarksSave } : {}),
            ...(remarksRefused ? { messages: { error: remarksRefused } } : {}),
            // Edited on this visit; the contract does not say who edited a remark before.
            remarkEditedBy: (row) =>
              row.obligationId && edits.remarks[row.obligationId] !== undefined ? viewerName : null,
            onRemarkChange: (row, remark) => {
              const id = row.obligationId;
              if (!id) return;
              // Only officers the draft lists now: one a recompile dropped would be refused
              // (400 `invalid-remarks`) on every later save.
              const listed = listedObligations(loaded);
              const next = updateEdits((current) => ({
                ...current,
                remarks: Object.fromEntries(
                  Object.entries({ ...current.remarks, [id]: remark }).filter(([each]) =>
                    listed.has(each),
                  ),
                ),
              }));
              remarksSave.change(next.remarks);
            },
          }
        : {},
    partI: (shown) =>
      capabilities.signsOff && editable(shown) ? (
        <PartIForm
          partI={shown.document.partI}
          autosave={partISave}
          onChange={(values) => {
            updateEdits((current) => ({ ...current, partI: values }));
            partISave.change(values);
          }}
        />
      ) : undefined,
    complaints: (shown) =>
      capabilities.signsOff && editable(shown) ? (
        <ComplaintsForm
          complaints={shown.document.partII.complaints}
          autosave={partBSave}
          onChange={(values) => {
            updateEdits((current) => ({ ...current, partB: values }));
            partBSave.change(values);
          }}
        />
      ) : undefined,
    footerActions: (shown) => footerActions(shown),
    footerNote: (shown) => footerNote(shown),
    banners: () =>
      state.step === 'step-up-failed' ? (
        <StepUpFailedBanner
          onRetry={() => {
            dispatch({ type: 'confirm-pressed' });
          }}
        />
      ) : state.step === 'refused' ? (
        <RefusedBanner reason={state.reason} paths={state.paths} />
      ) : null,
    submitted: (shown) => (
      <SubmittedHeader
        report={shown}
        documentLink={actions.documentLink}
        download={navigation.download}
        onSignedOut={() => {
          navigation.signIn(returnTo);
        }}
      />
    ),
  };

  function footerActions(shown: CompiledReport) {
    if (capabilities.reviews && shown.status === 'draft') {
      return (
        <>
          <Button
            type="button"
            onClick={() => {
              setReviewing(true);
            }}
          >
            <Icon icon={UserCheck01Icon} />
            {m.markReviewed}
          </Button>
          {reviewing ? (
            <MarkReviewedDialog
              name={viewerName}
              today={today}
              onClose={() => {
                setReviewing(false);
              }}
              onSignedOut={signIn}
              onMark={async (designation) => {
                const outcome = await actions.markReviewed(fy, designation);
                if (outcome.ok) await router.invalidate();
                return outcome;
              }}
            />
          ) : null}
        </>
      );
    }
    if (!capabilities.signsOff || !editable(shown)) return null;
    return (
      <>
        <Button
          type="button"
          disabled={!ready || state.step === 'stepping-up'}
          onClick={() => {
            dispatch({ type: 'confirm-pressed' });
          }}
        >
          <Icon icon={SecurityCheckIcon} />
          {m.confirmAndSubmit}
        </Button>
        {dialogOpen(state) ? (
          <ConfirmDialog
            state={state}
            fyLabel={fm.fyLabel(shown.fy)}
            name={viewerName}
            reviewer={shown.reviewedBy?.name ?? null}
            today={today}
            dueDate={shown.dueDate}
            onChecked={(checked) => {
              dispatch({ type: 'checked', checked });
            }}
            onSubmit={confirm}
            onClose={() => {
              dispatch({ type: 'dialog-closed' });
            }}
          />
        ) : null}
      </>
    );
  }

  function footerNote(shown: CompiledReport): string | null | undefined {
    if (capabilities.reviews) {
      return shown.status === 'reviewed' ? m.awaitingConfirmation : null;
    }
    if (!capabilities.signsOff) return undefined;
    if (shown.status !== 'reviewed') return m.awaitingReview;
    if (missing.length > 0) {
      const register = fm.missingFields.complaintsRegister;
      return m.stillToFill(
        missing.filter((field) => field !== register),
        missing.includes(register),
      );
    }
    if (unsaved) return m.unsaved;
    return saving ? m.saving : m.stepUpNote;
  }

  function sectionEdited(shown: CompiledReport, section: FormMDeclarationSectionKey): boolean {
    return shown.document.partII[section].nonFilers.some(
      (row) => row.obligationId !== undefined && edits.remarks[row.obligationId] !== undefined,
    );
  }

  const shownResult: FormMResult<FormMWorkspace> =
    data && report ? { ok: true, data: { ...data, report } } : result;
  return (
    <FormMWorkspaceView
      result={shownResult}
      capabilities={capabilities}
      extensions={extensions}
      {...props}
    />
  );
}
