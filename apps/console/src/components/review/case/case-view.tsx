import {
  Button,
  EmptyState,
  Icon,
  SegmentedChoice,
  Spinner,
  SplitPane,
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
  Timeline,
  Tooltip,
  useToast,
} from '@adili/ui';
import {
  Alert02Icon,
  Clock01Icon,
  JusticeScale01Icon,
  RefreshIcon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, useCallback, useId, useMemo, useState } from 'react';

import { newClarificationBlock } from '../../../clarification/list';
import { determinationState } from '../../../determination/view';
import { caseActions, versionLine } from '../../../review-case/case';
import {
  parseDeclaration,
  readDeclaration,
  reportingEntityOf,
} from '../../../review-case/declaration';
import { groupFlags, openFlagsByItem, openFlagsBySection } from '../../../review-case/flags';
import { REGISTRY_COPY } from '../../../review-case/messages';
import { recheckAccess, registryNeedsAttention } from '../../../review-case/registry';
import { timelineEvents } from '../../../review-case/timeline';
import {
  addCaseNote,
  getCaseAttachmentLink,
  markCaseFlagReviewed,
} from '../../../server/review-case';
import type { CaseView as CaseViewData } from '../../../server/review-case.server';
import type { Copilot } from '../../../server/copilot.server';
import type { ServiceError, ServiceResult } from '../../../server/service-call';
import { Page } from '../../page';
import { useCaseAssignment } from '../assignment';
import { CaseCopilot, type CaseCopilotProps } from '../copilot/case-copilot';
import { declarationAnchorId, highlightInDeclaration } from '../copilot/source-refs';
import { RecheckDialog } from './assignment-dialogs';
import { CaseClarifications } from '../case-clarifications';
import { useDraftWithAi } from '../draft-with-ai/use-draft-with-ai';
import { ClarificationComposer } from '../composer/clarification-composer';
import type { LetterCommission } from '../composer/letter-preview';
import { CaseHeader } from './case-header';
import { DeclarationPane, DeclarationUnavailable, DeclarationUnreadable } from './declaration-pane';
import { FlagsTab } from './flags-tab';
import { messages as t } from './messages';
import { NotesTab } from './notes-tab';
import { RegistryTab } from './registry-tab';
import { useCaseRegistry, useCooldown } from './use-case-registry';

/**
 * A review case (spec 07a FE-3; S8, S9, S11): the header with the assignment actions and the
 * registry Re-check, then the declaration as filed beside the review tools (Flags, Registry,
 * Clarifications, Notes, Timeline) in a resizable split pane, with the Copilot (spec 07c) above
 * the tabs, replacing them while open. Every view of the case is a recorded read of the
 * declaration, as the footer says.
 */

export type CaseTab = 'flags' | 'registry' | 'clarifications' | 'notes' | 'timeline';

/**
 * The registry Re-check (spec 07b FE-2): for the assignee or a supervisor, disabled while a
 * re-check runs, and disabled within ten minutes of the last one with a tooltip saying when the
 * next is accepted (review refuses it until then). Another reviewer sees it disabled, with why.
 */
function RecheckButton({
  forbidden,
  checking,
  availableAt,
  now,
  onClick,
}: {
  forbidden: boolean;
  checking: boolean;
  availableAt: number | null;
  now: number;
  onClick: () => void;
}) {
  const cooldown = useCooldown(availableAt, now);
  const reason = forbidden ? REGISTRY_COPY.recheck.forbidden : checking ? null : cooldown;
  const reasonId = useId();
  const content = (
    <>
      {checking ? <Spinner /> : <Icon icon={RefreshIcon} />}
      {checking ? REGISTRY_COPY.recheck.running : REGISTRY_COPY.recheck.action}
    </>
  );
  if (reason === null) {
    return (
      <Button size="sm" variant="secondary" disabled={checking} onClick={onClick}>
        {content}
      </Button>
    );
  }
  // Blocked, with why: still focusable (aria-disabled, no click handler) so keyboard and screen
  // reader users reach the button, hear the reason as its description, and get the tooltip.
  return (
    <>
      <Tooltip content={reason}>
        <Button
          size="sm"
          variant="secondary"
          aria-disabled="true"
          aria-describedby={reasonId}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-card aria-disabled:active:translate-y-0"
        >
          {content}
        </Button>
      </Tooltip>
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
    </>
  );
}

export interface CaseViewProps {
  load: CaseViewData;
  now: string;
  supervisor: boolean;
  /** The viewer's Commission, for the reassign dialog's reviewers. */
  slug: string | null;
  /** The letterhead of the Commission's clarification letters. */
  commission: LetterCommission;
  /** Re-reads the case (the declaration's Try again). */
  onReload?: () => Promise<void>;
  /** Fakes the Copilot in tests. */
  copilot?: Pick<CaseCopilotProps, 'api' | 'initial'>;
}

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
  slug,
  commission,
  onReload,
  copilot,
}: CaseViewProps) {
  const { detail, documentUnavailable, viewer } = load;
  const item = detail.case;
  const nowMs = Date.parse(now);
  const router = useRouter();
  const { toast } = useToast();
  const actions = caseActions(item, viewer.subject, supervisor);
  const view = useMemo(() => readDeclaration(detail.document), [detail.document]);
  const declaration = useMemo(() => parseDeclaration(detail.document), [detail.document]);
  const pins = useMemo(() => openFlagsByItem(detail.flags), [detail.flags]);
  const sectionPins = useMemo(() => openFlagsBySection(detail.flags), [detail.flags]);
  const openFlags = groupFlags(detail.flags).openCount;

  const [tab, setTab] = useState<CaseTab>('flags');
  const [pane, setPane] = useState<'main' | 'side'>('main');
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotStatus, setCopilotStatus] = useState<Copilot['status'] | null>(null);
  const [explain, setExplain] = useState<{ flagId: string; key: number } | null>(null);
  const [pulse, setPulse] = useState<{ flagId: string; key: number } | null>(null);
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const [composing, setComposing] = useState(false);
  const composeBlocked = newClarificationBlock(item, viewer.subject, now);
  // Flags picked in the copilot ("Add to clarification") are Draft with AI's in the composer.
  const drafting = useDraftWithAi({
    caseId: item.id,
    flags: detail.flags,
    copilotStatus,
    onCompose: () => {
      setComposing(true);
    },
    composeDisabled: composeBlocked !== null,
  });

  const onStatusChange = useCallback((status: Copilot['status'] | null) => {
    setCopilotStatus(status);
  }, []);

  const assignment = useCaseAssignment({
    viewer: { ...viewer, supervisor },
    slug,
    refresh: () => router.invalidate(),
    find: (caseId) => (caseId === item.id ? item : undefined),
  });
  const registry = useCaseRegistry({
    load: { detail, document: declaration },
    open: tab === 'registry',
    refresh: () => router.invalidate(),
  });
  const recheck = recheckAccess(item, { subject: viewer.subject, supervisor });

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

  function onAction(action: 'claim' | 'release' | 'reassign' | 'unassign') {
    assignment.start(action, { item, reviewerHistory: detail.reviewerHistory });
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
      sectionPins={sectionPins}
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
      assigneeName={item.assignee?.name}
      open={copilotOpen}
      onOpenChange={setCopilotOpen}
      explain={explain}
      onStatusChange={onStatusChange}
      selection={drafting.copilotSelection}
      {...copilot}
    />
  );

  const events = timelineEvents(detail.timeline);
  const side = (
    // One column no wider than the pane: long content (a source chip) is cut, never widens it.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
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
            <SideTab value="registry">
              {t.tabs.registry}
              {registryNeedsAttention(detail) ? (
                <span role="img" aria-label={REGISTRY_COPY.attention} className="inline-flex">
                  <Icon icon={Alert02Icon} strokeWidth={2.2} className="size-3.5 text-warning" />
                </span>
              ) : null}
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
          <TabsContent value="registry" className="mt-0 p-4">
            <RegistryTab
              layout={registry.layout}
              failed={registry.failed}
              retrying={registry.retrying}
              onRetry={registry.retry}
              checking={registry.checking}
              refusedUntil={registry.refusedUntil}
              now={nowMs}
              document={declaration}
              flagProps={{
                view,
                declarant: item.declarantName,
                canReview: actions.reviewFlags,
                canExplain: copilotStatus === 'ready' || copilotStatus === 'stale',
                onGoToItem: goToItem,
                onExplain: (flagId) => {
                  setExplain({ flagId, key: Date.now() });
                  setCopilotOpen(true);
                },
                onReview: async (flagId, note) =>
                  settle(
                    await markCaseFlagReviewed({ data: { caseId: item.id, flagId, note } }),
                    t.toasts.reviewed,
                    { inPlace: true },
                  ),
              }}
            />
          </TabsContent>
          <TabsContent value="clarifications" className="mt-0 p-4">
            <CaseClarifications
              reviewCase={item}
              clarifications={detail.clarifications}
              subject={viewer.subject}
              now={now}
              onNew={() => {
                setComposing(true);
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

  return (
    <Page>
      <CaseHeader
        detail={detail}
        reportingEntity={reportingEntityOf(detail.document)}
        viewer={viewer}
        actions={actions}
        supervisor={supervisor}
        now={nowMs}
        onAction={onAction}
        extraActions={[
          <DeterminationLink
            key="determination"
            caseId={item.id}
            propose={
              determinationState(item, detail.determinations, {
                subject: viewer.subject,
                supervisor,
              }).kind === 'none' && actions.mine
            }
          />,
          ...(recheck === 'hidden'
            ? []
            : [
                <RecheckButton
                  key="recheck"
                  forbidden={recheck === 'forbidden'}
                  checking={registry.checking}
                  availableAt={registry.availableAt}
                  now={nowMs}
                  onClick={() => {
                    registry.setConfirming(true);
                  }}
                />,
              ]),
        ]}
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
        open={composing}
        onOpenChange={setComposing}
        reviewCase={item}
        document={detail.document}
        commission={commission}
        now={now}
        tools={drafting.tools}
        onSaved={() => void router.invalidate()}
        onIssued={() => {
          drafting.clear();
          setCopilotOpen(false);
          setTab('clarifications');
          void router.invalidate();
        }}
      />
      {assignment.dialogs}
      <RecheckDialog
        open={registry.confirming}
        onOpenChange={registry.setConfirming}
        onConfirm={registry.recheck}
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

/**
 * The way to the case's Determination page (spec 08 FE-2): "Propose determination" for the
 * assignee while none is proposed, "Determination" for everyone else.
 */
function DeterminationLink({ caseId, propose }: { caseId: string; propose: boolean }) {
  return (
    <Button asChild size="sm" variant={propose ? 'default' : 'secondary'}>
      <Link to="/review/cases/$caseId/determination" params={{ caseId }}>
        <Icon icon={JusticeScale01Icon} />
        {propose ? t.actions.proposeDetermination : t.actions.determination}
      </Link>
    </Button>
  );
}
