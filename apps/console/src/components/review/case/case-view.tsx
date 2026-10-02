import type { Attachment } from '@adili/forms';
import {
  anchorIdFor,
  type AttachmentState,
  Button,
  cn,
  Icon,
  SegmentedChoice,
  SplitPane,
  Tabs,
  TabsContent,
  TabsCount,
  TabsList,
  TabsTrigger,
  useToast,
} from '@adili/ui';
import {
  ArrowLeftRightIcon,
  Undo02Icon,
  UserCheck01Icon,
  UserRemove01Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { flagTarget, pinsByItem } from '../../../review-case/flags';
import { CASE_COPY } from '../../../review-case/messages';
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
  claimCase,
  getCaseAttachmentLink,
  getReassignOfficers,
  markCaseFlagReviewed,
  reassignCase,
  releaseCase,
} from '../../../server/review-case';
import type { CaseFlag, CaseLoad } from '../../../server/review-case.server';
import type { ServiceError, ServiceResult } from '../../../server/service-call';
import { Page } from '../../page';
import { ClaimDialog, ReassignDialog, ReleaseDialog, UnassignDialog } from './assignment-dialogs';
import { CaseHeader, HeaderNote } from './case-header';
import { ClarificationsTab } from './clarifications-tab';
import { DECLARATION_ANCHORS, DeclarationPane } from './declaration-pane';
import { flagAnchorId, FlagsTab } from './flags-tab';
import { NotesTab } from './notes-tab';
import { TimelineTab } from './timeline-tab';

type Dialog = 'claim' | 'release' | 'reassign' | 'unassign' | null;

function failureText(error: ServiceError): string {
  if (error.kind === 'unauthenticated') return CASE_COPY.sessionEnded;
  return CASE_COPY.actionFailed;
}

/** 403, 404 and 409 mean the page is out of date: reload it rather than retry. */
function isStale(error: ServiceError): boolean {
  return error.kind === 'problem' && [403, 404, 409].includes(error.problem.status);
}

function scrollToId(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
}

export interface CaseViewProps {
  load: CaseLoad;
  viewer: CaseViewer & { name: string };
  /** The viewer's Commission, for the reassign dialog's officers. */
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
  const [dialog, setDialog] = useState<Dialog>(null);
  const [view, setView] = useState<'declaration' | 'review'>('declaration');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pulse, setPulse] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, AttachmentState>>({});
  const [retrying, setRetrying] = useState(false);
  const conflict = useRef(false);
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

  // A claim that lost the race reloads the case, then says who holds it now.
  useEffect(() => {
    if (!conflict.current) return;
    conflict.current = false;
    toast({
      title: item.assignee
        ? CASE_COPY.claimConflict(item.assignee.name)
        : CASE_COPY.claimConflictUnknown,
      urgency: 'assertive',
    });
  }, [item.assignee, toast]);

  async function refresh() {
    await router.invalidate();
  }

  /** Runs an assignment change; resolves to an error for the dialog, or null when done. */
  async function assign(
    run: () => Promise<ServiceResult<unknown>>,
    success: string,
  ): Promise<string | null> {
    const result = await run();
    if (!result.ok) {
      if (!isStale(result.error)) return failureText(result.error);
      setDialog(null);
      toast({ title: CASE_COPY.stale, urgency: 'assertive' });
      await refresh();
      return null;
    }
    setDialog(null);
    toast({ title: success });
    await refresh();
    return null;
  }

  async function claimNow(): Promise<string | null> {
    const result = await claimCase({ data: { caseId: item.id } });
    if (!result.ok && result.error.kind === 'problem' && result.error.problem.status === 409) {
      setDialog(null);
      conflict.current = true;
      await refresh();
      return null;
    }
    return assign(() => Promise.resolve(result), CASE_COPY.claimed);
  }

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
          if (viewer.supervisor) setDialog('claim');
          else
            void claimNow().then((error) => {
              if (error) toast({ title: error, urgency: 'assertive' });
            });
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
          setDialog('release');
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
          setDialog('reassign');
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
          setDialog('reassign');
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
          setDialog('unassign');
        }}
      >
        <Icon icon={UserRemove01Icon} />
        {CASE_COPY.unassign}
      </Button>
    ),
  };
  // Later slices append theirs here: the registry Re-check (spec 07b), Propose determination.
  const actions = assignmentActions(item, viewer).map((action) => ACTION_BUTTONS[action]);

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
        sideClassName={cn(
          'min-[1100px]:sticky min-[1100px]:top-[72px] min-[1100px]:max-h-[calc(100dvh-88px)] min-[1100px]:overflow-y-auto min-[1100px]:rounded-2xl',
          view === 'declaration' && 'max-[1099px]:hidden',
        )}
      />

      <p className="mt-4 text-xs text-muted-foreground">{CASE_COPY.audit}</p>

      <ClaimDialog
        open={dialog === 'claim'}
        onOpenChange={(open) => {
          setDialog(open ? 'claim' : null);
        }}
        reference={item.reference}
        name={item.declarantName}
        onConfirm={claimNow}
      />
      <ReleaseDialog
        open={dialog === 'release'}
        onOpenChange={(open) => {
          setDialog(open ? 'release' : null);
        }}
        reference={item.reference}
        onConfirm={() =>
          assign(() => releaseCase({ data: { caseId: item.id } }), CASE_COPY.released)
        }
      />
      <UnassignDialog
        open={dialog === 'unassign'}
        onOpenChange={(open) => {
          setDialog(open ? 'unassign' : null);
        }}
        reference={item.reference}
        holder={item.assignee?.name ?? ''}
        onConfirm={() =>
          assign(
            () => reassignCase({ data: { caseId: item.id, assignee: null } }),
            CASE_COPY.unassigned,
          )
        }
      />
      <ReassignDialog
        // A fresh dialog each time it opens: the officers reload and nobody is picked.
        key={dialog === 'reassign' ? 'reassign-open' : 'reassign-closed'}
        open={dialog === 'reassign'}
        onOpenChange={(open) => {
          setDialog(open ? 'reassign' : null);
        }}
        reference={item.reference}
        declarantName={item.declarantName}
        holder={item.assignee?.name ?? null}
        self={viewer.subject}
        loadOfficers={() =>
          slug
            ? getReassignOfficers({
                data: {
                  slug,
                  assignee: item.assignee?.subject ?? null,
                  reviewerHistory: detail.reviewerHistory,
                },
              })
            : Promise.resolve({ ok: false, error: { kind: 'unavailable', detail: null } })
        }
        onConfirm={(officer) =>
          assign(
            () => reassignCase({ data: { caseId: item.id, assignee: officer.subject } }),
            item.assignee ? CASE_COPY.reassigned(officer.name) : CASE_COPY.assigned(officer.name),
          )
        }
      />
    </Page>
  );
}
