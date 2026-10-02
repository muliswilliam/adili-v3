import {
  EmptyState,
  Icon,
  SegmentedChoice,
  SplitPane,
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
  Timeline,
  useToast,
} from '@adili/ui';
import { Clock01Icon, SquareLock02Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useCallback, useMemo, useState } from 'react';

import { type ComposerDraft } from '../../../clarification/composer';
import { newClarificationBlock } from '../../../clarification/list';
import { assignableOfficers, caseActions, versionLine } from '../../../review-case/case';
import { readDeclaration } from '../../../review-case/declaration';
import { groupFlags, openFlagsByItem, seedFromFlags } from '../../../review-case/flags';
import { timelineEvents } from '../../../review-case/timeline';
import {
  addCaseNote,
  claimCase,
  getCaseAttachmentLink,
  markCaseFlagReviewed,
  reassignCase,
  releaseCase,
} from '../../../server/review-case';
import type { CaseView as CaseViewData } from '../../../server/review-case.server';
import type { Copilot } from '../../../server/copilot.server';
import type { ServiceError, ServiceResult } from '../../../server/service-call';
import { Page } from '../../page';
import { CaseCopilot, type CaseCopilotProps } from '../copilot/case-copilot';
import { declarationAnchorId, highlightInDeclaration } from '../copilot/source-refs';
import {
  type AssignmentDialog,
  ClaimDialog,
  ReassignDialog,
  ReleaseDialog,
  UnassignDialog,
} from './assignment-dialogs';
import { CaseClarifications } from '../case-clarifications';
import {
  ClarificationComposer,
  type ClarificationComposerProps,
} from '../composer/clarification-composer';
import { employerOf, type LetterCommission } from '../composer/letter-preview';
import { CaseHeader } from './case-header';
import { DeclarationPane, DeclarationUnavailable, DeclarationUnreadable } from './declaration-pane';
import { FlagsTab } from './flags-tab';
import { messages as t } from './messages';
import { NotesTab } from './notes-tab';

/**
 * A review case (spec 07a FE-3; S8, S9, S11): the header with the assignment actions, then the
 * declaration as filed beside the review tools (Flags, Clarifications, Notes, Timeline) in a
 * resizable split pane, with the Copilot (spec 07c) above the tabs, replacing them while open.
 * Every view of the case is a recorded read of the declaration, as the footer says.
 */

export type CaseTab = 'flags' | 'clarifications' | 'notes' | 'timeline';

export interface CaseViewProps {
  load: CaseViewData;
  now: string;
  supervisor: boolean;
  /** The letterhead of the Commission's clarification letters. */
  commission: LetterCommission;
  /** Re-reads the case (the declaration's Try again). */
  onReload?: () => Promise<void>;
  /** Draft with AI (#288), above the composer's items. */
  composerTools?: ClarificationComposerProps['tools'];
  /** Fakes the Copilot in tests. */
  copilot?: Pick<CaseCopilotProps, 'api' | 'initial'>;
}

/** The case view's route, whose loader data a lost claim reads again. */
const CASE_ROUTE = '/review/cases/$caseId/';

function failureText(error: ServiceError): string {
  if (error.kind === 'unauthenticated') return t.toasts.sessionEnded;
  if (error.kind === 'problem' && error.problem.status === 403) return t.toasts.forbidden;
  if (error.kind === 'problem' && error.problem.status === 409) return t.toasts.stale;
  return t.toasts.failed;
}

/** 403 and 409 mean the page is out of date. */
function isStale(error: ServiceError): boolean {
  return error.kind === 'problem' && (error.problem.status === 403 || error.problem.status === 409);
}

export function CaseView({
  load,
  now,
  supervisor,
  commission,
  onReload,
  composerTools,
  copilot,
}: CaseViewProps) {
  const { detail, documentUnavailable, viewer } = load;
  const item = detail.case;
  const nowMs = Date.parse(now);
  const router = useRouter();
  const { toast } = useToast();
  const actions = caseActions(item, viewer.subject, supervisor);
  const view = useMemo(() => readDeclaration(detail.document), [detail.document]);
  const pins = useMemo(() => openFlagsByItem(detail.flags), [detail.flags]);
  const openFlags = groupFlags(detail.flags).openCount;

  const [tab, setTab] = useState<CaseTab>('flags');
  const [pane, setPane] = useState<'main' | 'side'>('main');
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotStatus, setCopilotStatus] = useState<Copilot['status'] | null>(null);
  const [explain, setExplain] = useState<{ flagId: string; key: number } | null>(null);
  const [pulse, setPulse] = useState<{ flagId: string; key: number } | null>(null);
  const [dialog, setDialog] = useState<AssignmentDialog | null>(null);
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; seed: ComposerDraft | null }>({
    open: false,
    seed: null,
  });
  // Flags picked in the copilot for a clarification ("Add to clarification").
  const [picked, setPicked] = useState<string[]>([]);
  const composeBlocked = newClarificationBlock(item, viewer.subject, now);

  const onStatusChange = useCallback((status: Copilot['status'] | null) => {
    setCopilotStatus(status);
  }, []);

  /** Shows how a call went; resolves to the error to show in place, or null. */
  async function settle<T>(
    result: ServiceResult<T>,
    success: string | null,
    { inPlace = false }: { inPlace?: boolean } = {},
  ): Promise<string | null> {
    if (result.ok) {
      if (success) toast({ title: success });
      await router.invalidate();
      return null;
    }
    const text = failureText(result.error);
    if (isStale(result.error) || !inPlace) {
      toast({ title: text, urgency: 'assertive' });
      if (isStale(result.error)) await router.invalidate();
      return inPlace ? null : text;
    }
    return text;
  }

  async function claim() {
    const result = await claimCase({ data: { caseId: item.id } });
    setDialog(null);
    if (!result.ok && result.error.kind === 'problem' && result.error.problem.status === 409) {
      // Another officer claimed it first: read who (waiting for the new case), and say so.
      await router.invalidate({ sync: true });
      const fresh = router.state.matches.find((match) => match.routeId === CASE_ROUTE)?.loaderData;
      const winner = fresh?.ok ? fresh.data.detail.case.assignee?.name : null;
      toast({ title: t.toasts.claimConflict(winner ?? null), urgency: 'assertive' });
      return;
    }
    await settle(result, t.toasts.claimed);
  }

  function onAction(action: 'claim' | 'release' | 'reassign' | 'unassign') {
    if (action === 'claim' && !supervisor) {
      void claim();
      return;
    }
    setDialog({ kind: action });
  }

  function openFlag(flagId: string) {
    setCopilotOpen(false);
    setTab('flags');
    setPane('side');
    setPulse({ flagId, key: Date.now() });
  }

  function goToItem(itemId: string) {
    setPane('main');
    // The pane may have to show first on a narrow screen.
    requestAnimationFrame(() => {
      highlightInDeclaration(declarationAnchorId({ kind: 'item', itemId }));
    });
  }

  async function download(uploadId: string) {
    setDownloading((current) => new Set(current).add(uploadId));
    const result = await getCaseAttachmentLink({ data: { caseId: item.id, uploadId } }).catch(
      () => ({ ok: false }) as const,
    );
    setDownloading((current) => {
      const next = new Set(current);
      next.delete(uploadId);
      return next;
    });
    if (result.ok) window.location.assign(result.data.downloadUrl);
    else toast({ title: t.toasts.linkFailed, urgency: 'assertive' });
  }

  async function retry() {
    setRetrying(true);
    await (onReload ? onReload() : router.invalidate());
    setRetrying(false);
  }

  const version = versionLine(detail);
  const main = documentUnavailable ? (
    <DeclarationUnavailable onRetry={() => void retry()} retrying={retrying} />
  ) : view ? (
    <DeclarationPane
      view={view}
      version={version.text}
      versionNumber={item.currentVersion}
      pins={pins}
      onOpenFlag={openFlag}
      onDownload={(uploadId) => void download(uploadId)}
      downloading={downloading}
    />
  ) : (
    <DeclarationUnreadable />
  );

  const copilotPanel = (
    <CaseCopilot
      caseId={item.id}
      detail={detail}
      access={actions.mine ? 'assignee' : supervisor ? 'supervisor' : 'viewer'}
      open={copilotOpen}
      onOpenChange={setCopilotOpen}
      explain={explain}
      onStatusChange={onStatusChange}
      selection={{
        flagIds: picked,
        onToggle: (flagId) => {
          setPicked((current) =>
            current.includes(flagId)
              ? current.filter((each) => each !== flagId)
              : [...current, flagId],
          );
        },
        onClear: () => {
          setPicked([]);
        },
        onCompose: () => {
          setComposer({ open: true, seed: seedFromFlags(detail.flags, picked) });
        },
        composeDisabled: composeBlocked !== null,
      }}
      {...copilot}
    />
  );

  const events = timelineEvents(detail.timeline);
  const side = (
    <div className="grid gap-3">
      {copilotPanel}
      {copilotOpen ? null : (
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as CaseTab);
          }}
          className="min-h-[200px] rounded-2xl bg-card shadow-card"
        >
          <TabsList
            aria-label={t.tabs.label}
            className="sticky -top-px z-[3] rounded-t-2xl bg-card px-2"
          >
            <SideTab value="flags" count={openFlags}>
              {t.tabs.flags}
            </SideTab>
            <SideTab value="clarifications" count={detail.clarifications.length}>
              {t.tabs.clarifications}
            </SideTab>
            <SideTab value="notes" count={detail.notes.length}>
              {t.tabs.notes}
            </SideTab>
            <SideTab value="timeline">{t.tabs.timeline}</SideTab>
          </TabsList>
          <TabsContent value="flags" className="mt-0 p-4">
            <FlagsTab
              flags={detail.flags}
              view={view}
              declarant={item.declarantName}
              canReview={actions.reviewFlags}
              canExplain={copilotStatus === 'ready' || copilotStatus === 'stale'}
              pulse={pulse}
              onGoToItem={goToItem}
              onExplain={(flagId) => {
                setExplain({ flagId, key: Date.now() });
                setCopilotOpen(true);
              }}
              onReview={async (flagId, note) =>
                settle(
                  await markCaseFlagReviewed({ data: { caseId: item.id, flagId, note } }),
                  t.toasts.reviewed,
                  { inPlace: true },
                )
              }
            />
          </TabsContent>
          <TabsContent value="clarifications" className="mt-0 p-4">
            <CaseClarifications
              reviewCase={item}
              clarifications={detail.clarifications}
              subject={viewer.subject}
              now={now}
              onNew={() => {
                setComposer({ open: true, seed: null });
              }}
            />
          </TabsContent>
          <TabsContent value="notes" className="mt-0 p-4">
            <NotesTab
              notes={detail.notes}
              viewerSubject={viewer.subject}
              onAdd={async (text) =>
                settle(await addCaseNote({ data: { caseId: item.id, text } }), t.toasts.noteAdded, {
                  inPlace: true,
                })
              }
            />
          </TabsContent>
          <TabsContent value="timeline" className="mt-0 p-4">
            {events.length > 0 ? (
              <Timeline events={events} now={nowMs} />
            ) : (
              <EmptyState
                icon={<Icon icon={Clock01Icon} />}
                title={t.timeline.emptyTitle}
                description={t.timeline.emptyBody}
              />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );

  const holder = item.assignee;
  return (
    <Page>
      <CaseHeader
        detail={detail}
        employer={employerOf(detail.document)}
        viewer={viewer}
        actions={actions}
        supervisor={supervisor}
        now={nowMs}
        onAction={onAction}
      />
      <SplitPane
        main={main}
        side={side}
        mainLabel={t.pane.main}
        sideLabel={t.pane.side}
        handleLabel={t.pane.handle}
        defaultSideWidth={460}
        narrowPane={pane}
        narrowSwitch={
          <SegmentedChoice
            variant="track"
            legend={t.pane.switchLabel}
            options={[
              { value: 'main', label: t.pane.switchDeclaration },
              { value: 'side', label: t.pane.switchReview },
            ]}
            value={pane}
            onValueChange={(value) => {
              setPane(value as 'main' | 'side');
            }}
          />
        }
      />
      <p className="mt-[22px] flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
        <Icon icon={SquareLock02Icon} className="size-3.5" />
        {t.audit}
      </p>

      <ClarificationComposer
        open={composer.open}
        onOpenChange={(open) => {
          setComposer((current) => ({ ...current, open }));
        }}
        reviewCase={item}
        document={detail.document}
        commission={commission}
        now={now}
        seed={composer.seed}
        tools={composerTools}
        onSaved={() => void router.invalidate()}
        onIssued={() => {
          setPicked([]);
          setCopilotOpen(false);
          setTab('clarifications');
          void router.invalidate();
        }}
      />
      <ClaimDialog
        open={dialog?.kind === 'claim'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        reference={item.reference}
        declarant={item.declarantName}
        onConfirm={claim}
      />
      <ReleaseDialog
        open={dialog?.kind === 'release'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        reference={item.reference}
        onConfirm={async () => {
          const result = await releaseCase({ data: { caseId: item.id } });
          setDialog(null);
          await settle(result, t.toasts.released);
        }}
      />
      <UnassignDialog
        open={dialog?.kind === 'unassign'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        reference={item.reference}
        holder={holder?.name ?? ''}
        onConfirm={async () => {
          const result = await reassignCase({ data: { caseId: item.id, assignee: null } });
          setDialog(null);
          await settle(result, t.toasts.unassigned);
        }}
      />
      <ReassignDialog
        open={dialog?.kind === 'reassign'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        reference={item.reference}
        declarant={item.declarantName}
        holder={holder}
        officers={assignableOfficers(detail, viewer)}
        viewerSubject={viewer.subject}
        reviewersOfRecord={detail.reviewerHistory}
        onConfirm={async (officer) => {
          const result = await reassignCase({
            data: { caseId: item.id, assignee: officer.subject },
          });
          setDialog(null);
          await settle(
            result,
            holder ? t.toasts.reassigned(officer.name) : t.toasts.assigned(officer.name),
          );
        }}
      />
    </Page>
  );
}

function SideTab({
  value,
  count,
  children,
}: {
  value: CaseTab;
  count?: number;
  children: ReactNode;
}) {
  return (
    <TabsTrigger value={value} className="gap-[5px] px-[7px] text-[13.5px]">
      {children}
      {count ? <TabsCount>{count}</TabsCount> : null}
    </TabsTrigger>
  );
}
