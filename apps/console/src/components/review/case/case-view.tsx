import type { Attachment } from '@adili/forms';
import {
  anchorIdFor,
  type AttachmentState,
  Button,
  cn,
  focusRing,
  Icon,
  SegmentedChoice,
  SplitPane,
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  Spinner,
  TabsTrigger,
  Tooltip,
  useToast,
} from '@adili/ui';
import {
  Alert02Icon,
  ArrowLeftRightIcon,
  RefreshIcon,
  Undo02Icon,
  UserCheck01Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

import { flagTarget, pinsByItem } from '../../../review-case/flags';
import { CASE_COPY, REGISTRY_COPY } from '../../../review-case/messages';
import { recheckAccess, registryNeedsAttention } from '../../../review-case/registry';
import { CASE_TAB_LABELS, CASE_TABS, type CaseTab, tabCount } from '../../../review-case/tabs';
import {
  type AssignmentAction,
  assignmentActions,
  type CaseViewer,
  holdsCase,
  readOnlyNote,
  separationCue,
} from '../../../review-case/view';
import {
  addCaseNote,
  getCaseAttachmentLink,
  markCaseFlagReviewed,
} from '../../../server/review-case';
import type { CaseFlag, CaseLoad } from '../../../server/review-case.server';
import { Page } from '../../page';
import { failureText, isStale, useCaseAssignment } from '../assignment';
import { RecheckDialog } from './assignment-dialogs';
import { CaseHeader, HeaderNote } from './case-header';
import { ClarificationsTab } from './clarifications-tab';
import { DECLARATION_ANCHORS, DeclarationPane } from './declaration-pane';
import { flagAnchorId, FlagsTab } from './flags-tab';
import { NotesTab } from './notes-tab';
import { RegistryTab } from './registry-tab';
import { TimelineTab } from './timeline-tab';
import { useCaseRegistry } from './use-case-registry';

function scrollToId(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
}

export interface CaseViewProps {
  load: CaseLoad;
  viewer: CaseViewer & { name: string };
  /** The viewer's Commission, for the reassign dialog's reviewers. */
  slug: string | null;
  now: number;
  tab: CaseTab;
  onTab: (tab: CaseTab) => void;
}

/**
 * A review case (spec 07a FE-3, `/review/cases/$caseId`): the header with the assignment
 * actions, then the declaration as filed beside the review tabs (Flags, Clarifications, Notes,
 * Timeline) in a `SplitPane`; below 1100px, a switch between the two. "Go to item" on a flag
 * scrolls to its item and highlights it; an item's pin brings its flag back into view. The
 * footer says the view is recorded.
 *
 * Later slices extend it in two places: a tab (spec 07b's Registry) is one more `CASE_TABS`
 * entry and one more panel in `panels`; a case action (the registry Re-check, Propose
 * determination) is one more element after the assignment buttons in `actions`.
 */
export function CaseView({ load, viewer, slug, now, tab, onTab }: CaseViewProps) {
  const { detail, document } = load;
  const item = detail.case;
  const router = useRouter();
  const { toast } = useToast();
  const [view, setView] = useState<'declaration' | 'review'>('declaration');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pulse, setPulse] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, AttachmentState>>({});
  const [retrying, setRetrying] = useState(false);
  // The open tab follows the address (`tab`), and changes here at once, before the address does,
  // so a pin can open Flags and scroll to its flag in one go.
  const [active, setActive] = useState<CaseTab>(tab);
  const [addressTab, setAddressTab] = useState<CaseTab>(tab);
  if (tab !== addressTab) {
    setAddressTab(tab);
    setActive(tab);
  }

  function openTab(next: CaseTab) {
    setActive(next);
    onTab(next);
  }

  const holder = holdsCase(item, viewer);
  const pins = pinsByItem(detail.flags);
  const previousVersion = item.currentVersion > 1 ? item.currentVersion - 1 : null;

  // A pulse plays once; clear it so the same flag can pulse again.
  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => {
      setPulse(null);
    }, 1700);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pulse]);

  async function refresh() {
    await router.invalidate();
  }

  const assignment = useCaseAssignment({
    viewer,
    slug,
    refresh,
    find: (caseId) => (caseId === item.id ? item : undefined),
  });
  const startAssignment = (action: AssignmentAction) => {
    assignment.start(action, { item, reviewerHistory: detail.reviewerHistory });
  };

  const registry = useCaseRegistry({ load, open: active === 'registry', refresh });
  const { checking } = registry;

  function goTo(flag: CaseFlag) {
    const target = flagTarget(flag, document);
    if (!target) return;
    // Reveal the item first (the declaration view, on a narrow screen), then scroll to it.
    flushSync(() => {
      setHighlight(target.highlight);
      setView('declaration');
    });
    const anchor = anchorIdFor(target, DECLARATION_ANCHORS);
    if (anchor) scrollToId(anchor);
  }

  /** "Go to item" from a registry's match table: the declared item the record matched. */
  function goToItem(itemId: string) {
    flushSync(() => {
      setHighlight(itemId);
      setView('declaration');
    });
    const anchor = anchorIdFor({ itemId }, DECLARATION_ANCHORS);
    if (anchor) scrollToId(anchor);
  }

  function showFlag(flagId: string) {
    flushSync(() => {
      openTab('flags');
      setView('review');
      setPulse(flagId);
    });
    scrollToId(flagAnchorId(flagId));
  }

  async function review(flag: CaseFlag, note: string): Promise<string | null> {
    const result = await markCaseFlagReviewed({
      data: { caseId: item.id, flagId: flag.id, note },
    });
    if (!result.ok) {
      if (!isStale(result.error)) return failureText(result.error);
      setEditing(null);
      toast({
        title:
          result.error.kind === 'problem' && result.error.problem.status === 409
            ? CASE_COPY.flags.alreadyReviewed
            : CASE_COPY.stale,
        urgency: 'assertive',
      });
      await refresh();
      return null;
    }
    setEditing(null);
    toast({ title: CASE_COPY.flags.marked });
    await refresh();
    return null;
  }

  async function addNote(text: string): Promise<string | null> {
    const result = await addCaseNote({ data: { caseId: item.id, text } });
    if (!result.ok) return failureText(result.error);
    toast({ title: CASE_COPY.notes.added });
    await refresh();
    return null;
  }

  async function download(attachment: Attachment) {
    setDownloads((all) => ({ ...all, [attachment.uploadId]: 'busy' }));
    const result = await getCaseAttachmentLink({
      data: { caseId: item.id, uploadId: attachment.uploadId },
    }).catch(() => ({ ok: false }) as const);
    setDownloads((all) => ({ ...all, [attachment.uploadId]: result.ok ? 'done' : 'idle' }));
    if (result.ok) window.location.assign(result.data.downloadUrl);
    else toast({ title: CASE_COPY.declaration.downloadFailed });
  }

  const ACTION_BUTTONS: Record<AssignmentAction, ReactNode> = {
    claim: (
      <Button
        key="claim"
        size="sm"
        onClick={() => {
          startAssignment('claim');
        }}
      >
        <Icon icon={UserCheck01Icon} />
        {CASE_COPY.claim}
      </Button>
    ),
    release: (
      <Button
        key="release"
        size="sm"
        variant="secondary"
        onClick={() => {
          startAssignment('release');
        }}
      >
        <Icon icon={Undo02Icon} />
        {CASE_COPY.release}
      </Button>
    ),
    reassign: (
      <Button
        key="reassign"
        size="sm"
        variant="secondary"
        onClick={() => {
          startAssignment('reassign');
        }}
      >
        <Icon icon={ArrowLeftRightIcon} />
        {CASE_COPY.reassign}
      </Button>
    ),
    assign: (
      <Button
        key="assign"
        size="sm"
        variant="secondary"
        onClick={() => {
          startAssignment('assign');
        }}
      >
        <Icon icon={ArrowLeftRightIcon} />
        {CASE_COPY.assign}
      </Button>
    ),
    unassign: (
      <Button
        key="unassign"
        size="sm"
        variant="ghost"
        onClick={() => {
          startAssignment('unassign');
        }}
      >
        <Icon icon={UserRemove01Icon} />
        {CASE_COPY.unassign}
      </Button>
    ),
  };
  // Later slices append theirs after the registry Re-check: Propose determination.
  const actions = assignmentActions(item, viewer).map((action) => ACTION_BUTTONS[action]);
  const recheck = recheckAccess(item, viewer);
  if (recheck !== 'hidden') {
    const button = (
      <Button
        key="recheck"
        size="sm"
        variant="secondary"
        disabled={recheck === 'forbidden' || checking}
        onClick={() => {
          registry.setConfirming(true);
        }}
      >
        {checking ? <Spinner /> : <Icon icon={RefreshIcon} />}
        {checking ? REGISTRY_COPY.recheck.running : REGISTRY_COPY.recheck.action}
      </Button>
    );
    actions.push(
      recheck === 'forbidden' ? (
        <Tooltip key="recheck" content={REGISTRY_COPY.recheck.forbidden}>
          <span tabIndex={0} className={cn(focusRing, 'inline-flex rounded-lg')}>
            {button}
          </span>
        </Tooltip>
      ) : (
        button
      ),
    );
  }

  const readOnly = readOnlyNote(item, viewer);
  const notes = (
    <>
      {separationCue(detail, viewer) ? (
        <HeaderNote tone="warning">{CASE_COPY.separation}</HeaderNote>
      ) : null}
      {readOnly ? <HeaderNote tone="neutral">{readOnly}</HeaderNote> : null}
    </>
  );

  const panels: Record<CaseTab, ReactNode> = {
    flags: (
      <FlagsTab
        flags={detail.flags}
        document={document}
        previousVersion={previousVersion}
        currentVersion={item.currentVersion}
        canReview={holder}
        editing={editing}
        pulse={pulse}
        onEdit={(flag) => {
          setEditing(flag.id);
        }}
        onCancel={() => {
          setEditing(null);
        }}
        onReview={review}
        onGo={goTo}
      />
    ),
    registry: (
      <RegistryTab
        layout={registry.layout}
        failed={registry.failed}
        retrying={registry.retrying}
        onRetry={registry.retry}
        checking={checking}
        cooldown={registry.cooldown}
        onGoToItem={goToItem}
        document={document}
        previousVersion={previousVersion}
        currentVersion={item.currentVersion}
        canReview={holder}
        editing={editing}
        onEdit={(flag) => {
          setEditing(flag.id);
        }}
        onCancel={() => {
          setEditing(null);
        }}
        onReview={review}
        onGo={goTo}
      />
    ),
    clarifications: <ClarificationsTab caseId={item.id} clarifications={detail.clarifications} />,
    notes: <NotesTab notes={detail.notes} subject={viewer.subject} onAdd={addNote} />,
    timeline: <TimelineTab entries={detail.timeline} now={now} />,
  };

  const side = (
    <Tabs
      value={active}
      onValueChange={(next) => {
        setEditing(null);
        openTab(next as CaseTab);
      }}
      className="rounded-2xl bg-card shadow-card"
    >
      <TabsList
        aria-label={CASE_COPY.tabsLabel}
        className="sticky top-0 z-[3] rounded-t-2xl bg-card px-2"
      >
        {CASE_TABS.map((key) => {
          const count = tabCount(key, detail);
          return (
            <TabsTrigger key={key} value={key} className="gap-[5px] px-[7px] text-[13.5px]">
              {CASE_TAB_LABELS[key]}
              {count ? <TabsCount>{count}</TabsCount> : null}
              {key === 'registry' && registryNeedsAttention(detail) ? (
                <span role="img" aria-label={REGISTRY_COPY.attention} className="inline-flex">
                  <Icon icon={Alert02Icon} strokeWidth={2.2} className="size-3.5 text-warning" />
                </span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {CASE_TABS.map((key) => (
        <TabsContent key={key} value={key} className="mt-0 rounded-b-2xl p-4">
          {panels[key]}
        </TabsContent>
      ))}
    </Tabs>
  );

  const main = (
    <DeclarationPane
      document={document}
      version={item.currentVersion}
      versions={detail.versions.length}
      highlight={highlight}
      pins={pins}
      onPin={showFlag}
      onAttachment={(attachment) => void download(attachment)}
      attachmentState={(uploadId) => downloads[uploadId] ?? 'idle'}
      retrying={retrying}
      onRetry={() => {
        setRetrying(true);
        void refresh().finally(() => {
          setRetrying(false);
        });
      }}
    />
  );

  return (
    <Page>
      <CaseHeader
        detail={detail}
        employer={document?.officer.employment.employer ?? null}
        subject={viewer.subject}
        now={now}
        actions={actions.length > 0 ? actions : null}
        notes={notes}
      />

      <SegmentedChoice
        variant="track"
        legend={CASE_COPY.views.label}
        options={[
          { value: 'declaration', label: CASE_COPY.views.declaration },
          { value: 'review', label: CASE_COPY.views.review },
        ]}
        value={view}
        onValueChange={(next) => {
          setView(next as 'declaration' | 'review');
        }}
        className="mb-3 w-full min-[1100px]:hidden"
      />

      <SplitPane
        label={CASE_COPY.resizeLabel}
        defaultSize={440}
        min={340}
        max={720}
        main={main}
        side={side}
        // Below 1100px the panes become two views with a switch (the prototype's `.mview`).
        className="max-[1099px]:grid-cols-1 max-[1099px]:[&>[role=separator]]:hidden"
        mainClassName={cn(view === 'review' && 'max-[1099px]:hidden')}
        // No scroll anchoring in the review pane: when a tab's content changed or a tab opened,
        // the browser kept a card in place and scrolled the tab's top out of sight.
        sideClassName={cn(
          'min-[1100px]:sticky min-[1100px]:top-[72px] min-[1100px]:max-h-[calc(100dvh-88px)] min-[1100px]:overflow-y-auto min-[1100px]:[overflow-anchor:none] min-[1100px]:rounded-2xl',
          view === 'declaration' && 'max-[1099px]:hidden',
        )}
      />

      <p className="mt-4 text-xs text-muted-foreground">{CASE_COPY.audit}</p>

      {assignment.dialogs}
      <RecheckDialog
        open={registry.confirming}
        onOpenChange={registry.setConfirming}
        onConfirm={registry.recheck}
      />
    </Page>
  );
}
