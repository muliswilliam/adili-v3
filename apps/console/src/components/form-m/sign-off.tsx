import {
  type Autosave,
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
import type { ComplianceReport } from '../../server/reporting/types';
import { confirmReducer, dialogOpen, initialConfirmState, type StepUpMarker } from './confirm';
import {
  type CompiledReport,
  type FormMReportExtensions,
  FormMWorkspaceView,
  type FormMWorkspaceViewProps,
} from './form-m-workspace';
import { manualMissing } from './form-m-view';
import { messages as fm } from './messages';
import {
  ConfirmDialog,
  MarkReviewedDialog,
  RefusedBanner,
  StepUpFailedBanner,
} from './sign-off-dialogs';
import { messages as m } from './sign-off-messages';
import {
  ComplaintsForm,
  emailTakes,
  PartIForm,
  type PartBValues,
  type PartIValues,
} from './sign-off-parts';
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
  /** By section, then obligation id. */
  remarks: Record<FormMDeclarationSectionKey, Record<string, string>>;
  partI: Partial<PartIValues>;
  partB: PartBValues | null;
}

const NO_EDITS: Edits = {
  remarks: { initial: {}, biennial: {}, final: {} },
  partI: {},
  partB: null,
};

/** Remarks, Part I and Part B can change: a draft or a reviewed report, not a preview's footer. */
const editable = (report: ComplianceReport) =>
  report.document !== null && (report.status === 'draft' || report.status === 'reviewed');

/** The report with this visit's edits laid over its document, as the service now holds it. */
function withEdits(report: ComplianceReport, edits: Edits): ComplianceReport {
  const { document } = report;
  if (!document || !editable(report)) return report;
  const { partII } = document;
  const remarked = (key: FormMDeclarationSectionKey) => ({
    ...partII[key],
    nonFilers: partII[key].nonFilers.map((row) => {
      const remark = row.obligationId ? edits.remarks[key][row.obligationId] : undefined;
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

/** A save the service refused for good stops; anything else is retried with backoff. */
function settle(result: FormMResult<null>): void {
  if (result.ok) return;
  const { error } = result;
  // A recompile running: passing, so retry. The network or a 5xx: the same.
  if (error.kind === 'unavailable') throw new Error('unavailable');
  if (error.kind === 'problem' && error.problem.code === 'report-compiling') {
    throw new Error('compiling');
  }
  throw new AutosaveFailure('error', error.kind === 'problem' ? error.problem.code : error.kind);
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
  const [reviewing, setReviewing] = useState(false);
  const [state, dispatch] = useReducer(confirmReducer, initialConfirmState);
  const returnTo = `/form-m?fy=${String(fy)}`;

  // One autosave per section, so each says how its own remarks stand; a save sends that
  // section's edited rows (the service keeps the others).
  const saveSectionRemarks = useCallback(
    async (remarks: Remarks) => {
      settle(await actions.saveRemarks(fy, remarks));
    },
    [actions, fy],
  );
  const remarksSaves: Record<FormMDeclarationSectionKey, Autosave<Remarks>> = {
    initial: useAutosave<Remarks>(saveSectionRemarks),
    biennial: useAutosave<Remarks>(saveSectionRemarks),
    final: useAutosave<Remarks>(saveSectionRemarks),
  };
  const partISave = useAutosave<PartIValues>(
    useCallback(
      async (values) => {
        settle(await actions.saveManualFields(fy, partIFields(values)));
      },
      [actions, fy],
    ),
  );
  const partBSave = useAutosave<PartBValues>(
    useCallback(
      async ({ registerMaintained, items }) => {
        settle(
          await actions.saveManualFields(fy, {
            complaintsRegisterMaintained: registerMaintained,
            complaints: items,
          }),
        );
      },
      [actions, fy],
    ),
    { delayMs: 0 },
  );

  const report = loaded ? withEdits(loaded, edits) : null;
  const document = report?.document ?? null;
  const missing = document ? manualMissing(document) : [];
  const saving = [partISave, partBSave].some((save) => PENDING.has(save.status));
  const ready =
    capabilities.signsOff && report?.status === 'reviewed' && missing.length === 0 && !saving;

  // Back from the step-up: drop the marker, so a reload does not reopen the dialog, then open
  // it if the session holds a fresh step-up and the report can still be confirmed.
  const handled = useRef(false);
  useEffect(() => {
    if (!stepUpMarker || handled.current) return;
    handled.current = true;
    navigation.clearStepUpMarker();
    if (!ready) return;
    const fresh = stepUpMarker === 'done' ? actions.stepUpFresh() : Promise.resolve(false);
    void fresh
      .catch(() => null)
      .then((isFresh) => {
        dispatch({
          type: 'step-up-returned',
          confirmed: isFresh === true,
          key: crypto.randomUUID(),
        });
      });
  }, [stepUpMarker, ready, actions, navigation]);

  useEffect(() => {
    if (state.step === 'stepping-up') navigation.stepUp(returnTo);
    if (state.step === 'signed-out') navigation.signIn(returnTo);
    if (state.step === 'submitted' || state.step === 'refused') void router.invalidate();
  }, [state.step, navigation, returnTo, router]);

  const confirm = () => {
    if (state.step !== 'confirm' || !state.checked) return;
    const { key } = state;
    dispatch({ type: 'submit-pressed' });
    void actions
      .confirm(fy, key)
      .catch((): ConfirmOutcome => ({ status: 'unavailable' }))
      .then((answer) => {
        dispatch({ type: 'answered', answer });
      });
  };

  const extensions: FormMReportExtensions = {
    sectionProps: (section, shown) =>
      capabilities.reviews && editable(shown)
        ? {
            autosave: remarksSaves[section],
            // Edited on this visit; the contract does not say who edited a remark before.
            remarkEditedBy: (row) =>
              row.obligationId && edits.remarks[section][row.obligationId] !== undefined
                ? viewerName
                : null,
            onRemarkChange: (row, remark) => {
              if (!row.obligationId) return;
              const remarks = { ...edits.remarks[section], [row.obligationId]: remark };
              setEdits({ ...edits, remarks: { ...edits.remarks, [section]: remarks } });
              remarksSaves[section].change(remarks);
            },
          }
        : {},
    partI: (shown) =>
      capabilities.signsOff && editable(shown) ? (
        <PartIForm
          partI={shown.document.partI}
          autosave={partISave}
          onChange={(values) => {
            setEdits({ ...edits, partI: values });
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
            setEdits({ ...edits, partB: values });
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
    return saving ? m.saving : null;
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
