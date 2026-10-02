import { Button, Icon, Tabs, TabsCount, TabsList, TabsTrigger, Tooltip } from '@adili/ui';
import { Alert02Icon, Cancel01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useId, useState } from 'react';

import type { CaseDetail, Flag } from '../../../server/review/types';
import { type CopilotAccess, explanationBlock } from './copilot-view';
import { flagAnchor, FlagsTab, SelectionBar } from './flags-tab';
import {
  AiTile,
  Callout,
  type CopilotTab,
  type FlagSelection,
  type OpenSource,
  PanelBody,
  PanelLabel,
  type ResolveRef,
  RetryButton,
  TabContent,
} from './panel-parts';
import { Failed, NotEnabled, Waiting, WhyDialog } from './panel-states';
import { Rating } from './rating';
import { SummaryTab } from './summary-tab';
import { messages as t } from './messages';
import type { CaseCopilot } from './use-case-copilot';

export { CopilotLauncher } from './copilot-launcher';
export type { CopilotTab } from './panel-parts';

/**
 * The Copilot on a review case (spec 07c FE-2, S10, S11, S13, S15), as the 07a-review prototype
 * draws it: a launcher bar above the case's side tabs, and the panel that replaces them when
 * opened, with the Summary and Flags tabs. Every AI block carries an AI label; nothing here
 * decides anything.
 */

export interface CopilotPanelProps {
  state: CaseCopilot;
  access: CopilotAccess;
  /** The case's flags (review.yaml `Flag`), explained on the Flags tab. */
  flags: Flag[];
  versions: CaseDetail['versions'];
  /** Reads a source ref against the case's declaration; null leaves the ref out. */
  resolveRef: ResolveRef;
  /** The case has an earlier declaration, so "Changes since previous version" can say none. */
  hasPrevious: boolean;
  onClose: () => void;
  /** Re-requests the outputs; the container shows what went wrong. */
  onRefresh: () => void;
  /** Opens a source ref's target in the declaration pane, highlighted. */
  onOpenSource: OpenSource;
  /**
   * Flags picked for a clarification ("Add to clarification", spec 07c FE-3), for the assignee.
   * Leave out to hide the buttons.
   */
  selection?: FlagSelection;
  /** Opens a flag's explanation on the Flags tab (Explain on a flag); a new `key` each time. */
  explain?: { flagId: string; key: number } | null;
  now: Date;
}

/** The open Copilot panel, in each of its states. */
export function CopilotPanel({
  state,
  access,
  flags,
  versions,
  resolveRef,
  hasPrevious,
  onClose,
  onRefresh,
  onOpenSource,
  selection,
  explain,
  now,
}: CopilotPanelProps) {
  const headingId = useId();
  const [tab, setTab] = useState<CopilotTab>(explain ? 'flags' : 'summary');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    explain ? { [explain.flagId]: true } : {},
  );
  const [pulse, setPulse] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const { copilot, error, stopped, sessionEnded, refreshing } = state;
  const status = copilot?.status ?? null;
  const busy = status === 'pending' || status === 'stale';
  // Not enabled may have changed since (the Commission's AI policy): a refresh asks again.
  const canRefresh = access !== 'viewer' && copilot !== null;

  function openFlag(flagId: string) {
    setTab('flags');
    setExpanded({ [flagId]: true });
    setPulse(flagId);
  }

  // Explain on a flag outside the panel: each new key opens that flag.
  const [explained, setExplained] = useState(explain?.key);
  if (explain && explain.key !== explained) {
    setExplained(explain.key);
    openFlag(explain.flagId);
  }

  useEffect(() => {
    if (!pulse) return;
    document
      .getElementById(flagAnchor(pulse))
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const timer = setTimeout(() => {
      setPulse(null);
    }, 1_700);
    return () => {
      clearTimeout(timer);
    };
  }, [pulse]);

  const content = copilot && (status === 'ready' || status === 'stale') ? copilot.summary : null;

  const top = (
    <div className="sticky top-0 z-[3] rounded-t-2xl bg-card">
      <div className="flex items-center gap-2.5 pt-3 pr-2.5 pl-3.5">
        <AiTile />
        <h2 id={headingId} className="text-[15px] font-semibold">
          {t.title}
        </h2>
        <span className="flex-1" />
        {canRefresh ? (
          <Tooltip content={t.refreshTip}>
            <Button
              variant="ghost"
              size="icon"
              className="[&_svg]:size-4"
              aria-label={t.refresh}
              disabled={busy || refreshing}
              onClick={onRefresh}
            >
              <Icon icon={RefreshIcon} />
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip content={t.closeTip}>
          <Button
            variant="ghost"
            size="icon"
            className="[&_svg]:size-[17px]"
            aria-label={t.close}
            onClick={onClose}
          >
            <Icon icon={Cancel01Icon} />
          </Button>
        </Tooltip>
      </div>
      {copilot && content ? (
        <>
          <PanelLabel copilot={copilot} label={content.label} versions={versions} now={now} />
          <TabsList aria-label={t.tabs.label} className="mt-1.5 px-2">
            <TabsTrigger value="summary" className="px-2 text-[13.5px]">
              {t.tabs.summary}
            </TabsTrigger>
            <TabsTrigger value="flags" className="px-2 text-[13.5px]">
              {t.tabs.flags}
              <TabsCount>{flags.length}</TabsCount>
            </TabsTrigger>
          </TabsList>
          {tab === 'flags' && selection && access === 'assignee' ? (
            <SelectionBar selection={selection} />
          ) : null}
        </>
      ) : null}
    </div>
  );

  const live = (
    <div className="sr-only" role="status" aria-live="polite">
      {status === 'pending'
        ? t.live.pending
        : status === 'stale'
          ? t.live.stale
          : status === 'ready'
            ? t.live.ready
            : ''}
    </div>
  );

  let body: ReactNode;
  if (!copilot) {
    body = error ? (
      <PanelBody>
        <Callout
          tone="warning"
          icon={Alert02Icon}
          action={
            error === 'unavailable' ? (
              <RetryButton onClick={state.retry}>{t.tryAgain}</RetryButton>
            ) : null
          }
        >
          {error === 'unauthenticated' ? t.sessionEnded : t.loadFailed}
        </Callout>
        <p className="text-[13px] text-muted-foreground">{t.worksAsUsual}</p>
      </PanelBody>
    ) : (
      <Waiting stopped={false} onCheckAgain={state.retry} />
    );
  } else if (status === 'not-enabled') {
    body = (
      <NotEnabled
        onLearnWhy={() => {
          setWhyOpen(true);
        }}
      />
    );
  } else if (status === 'failed') {
    body = (
      <Failed
        reason={copilot.failureReason}
        canRetry={canRefresh && copilot.failureReason !== 'budget'}
        retrying={refreshing}
        onRetry={onRefresh}
        now={now}
      />
    );
  } else if (!content) {
    body = <Waiting stopped={stopped} sessionEnded={sessionEnded} onCheckAgain={state.retry} />;
  } else {
    const stale = status === 'stale';
    body = (
      <>
        <TabContent
          value="summary"
          stale={stale}
          stopped={stopped}
          sessionEnded={sessionEnded}
          onCheckAgain={state.retry}
        >
          <SummaryTab
            summary={content}
            flags={flags}
            resolveRef={resolveRef}
            hasPrevious={hasPrevious}
            onOpenSource={onOpenSource}
            onOpenFlag={openFlag}
            rate={(block, group) => (
              <Rating
                state={state}
                access={access}
                jobId={copilot.jobs.summarize}
                block={block}
                group={group}
              />
            )}
          />
        </TabContent>
        <TabContent
          value="flags"
          stale={stale}
          stopped={stopped}
          sessionEnded={sessionEnded}
          onCheckAgain={state.retry}
        >
          <FlagsTab
            flags={flags}
            explanations={copilot.explanations?.explanations ?? []}
            label={copilot.explanations?.label ?? null}
            expanded={expanded}
            pulse={pulse}
            onToggle={(flagId) => {
              setExpanded((current) => ({ ...current, [flagId]: !current[flagId] }));
            }}
            resolveRef={resolveRef}
            onOpenSource={onOpenSource}
            selection={access === 'assignee' ? selection : undefined}
            rate={(flagId, group) => (
              <Rating
                state={state}
                access={access}
                jobId={copilot.jobs.explain}
                block={explanationBlock(flagId)}
                group={group}
              />
            )}
          />
        </TabContent>
      </>
    );
  }

  const panel = (
    <aside
      aria-labelledby={headingId}
      className="min-h-[200px] rounded-2xl bg-card text-card-foreground shadow-card"
    >
      {top}
      {live}
      {body}
      <WhyDialog open={whyOpen} onOpenChange={setWhyOpen} />
    </aside>
  );

  return content ? (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        setTab(value as CopilotTab);
      }}
    >
      {panel}
    </Tabs>
  ) : (
    panel
  );
}
