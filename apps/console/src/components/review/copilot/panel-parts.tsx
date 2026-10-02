import {
  AiLabel,
  Button,
  cn,
  Icon,
  IconTile,
  SourceRefLink,
  Spinner,
  TabsContent,
} from '@adili/ui';
import {
  Alert02Icon,
  Clock01Icon,
  InformationCircleIcon,
  RefreshIcon,
  SparklesIcon,
  UnavailableIcon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId } from 'react';

import { formatRelativeTime } from '../../format';
import { goToSignIn } from '../../sign-in-redirect';
import type { Copilot, CopilotAiLabel, CopilotSourceRef } from '../../../server/copilot.server';
import type { CaseDetail } from '../../../server/review/types';
import { versionNumber } from './copilot-view';
import { messages as t } from './messages';
import type { ResolvedRef } from './source-refs';

/** The pieces the Copilot panel is built of: its tile, label, body, callouts and blocks. */

export type CopilotTab = 'summary' | 'flags';

/** Reads a source ref against the case's declaration; null leaves the ref out. */
export type ResolveRef = (ref: CopilotSourceRef) => ResolvedRef | null;

/** Opens a source ref's target in the declaration pane, highlighted. */
export type OpenSource = (resolved: ResolvedRef) => void;

/**
 * Flags picked for a clarification ("Add to clarification", spec 07c FE-3), for the assignee.
 */
export interface FlagSelection {
  flagIds: string[];
  onToggle: (flagId: string) => void;
  onClear: () => void;
  /** Opens the composer with the picked flags; leave out while there is no composer. */
  onCompose?: () => void;
  /** The six-month window for clarifications has closed. */
  composeDisabled?: boolean;
}

export function AiTile({ off = false }: { off?: boolean }) {
  return (
    <IconTile
      size="xs"
      tone={off ? 'default' : 'ai'}
      className={cn(off && 'text-muted-foreground')}
    >
      <Icon icon={off ? UnavailableIcon : SparklesIcon} />
    </IconTile>
  );
}

export function PanelLabel({
  copilot,
  label,
  versions,
  now,
}: {
  copilot: Copilot;
  label: CopilotAiLabel;
  versions: CaseDetail['versions'];
  now: Date;
}) {
  const generatedAt = copilot.generatedAt ?? label.generatedAt;
  return (
    <div className="flex px-3.5 pt-2">
      <AiLabel
        details={label}
        text={t.label(
          formatRelativeTime(generatedAt, now),
          versionNumber(copilot.forVersionId, versions),
        )}
      />
    </div>
  );
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-3.5 p-4', className)}>{children}</div>;
}

export function TabContent({
  value,
  stale,
  stopped,
  sessionEnded,
  onCheckAgain,
  children,
}: {
  value: CopilotTab;
  stale: boolean;
  /** Polling stopped while still stale. */
  stopped: boolean;
  /** The session ended while stale: polling stopped for good. */
  sessionEnded: boolean;
  onCheckAgain: () => void;
  children: ReactNode;
}) {
  return (
    <TabsContent value={value} className="mt-0 rounded-none rounded-b-2xl">
      <PanelBody>
        {stale && sessionEnded ? (
          <SessionEnded />
        ) : stale && stopped ? (
          <Callout
            tone="neutral"
            icon={Clock01Icon}
            action={<RetryButton onClick={onCheckAgain}>{t.checkAgain}</RetryButton>}
          >
            {t.stillUpdating}
          </Callout>
        ) : stale ? (
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-lg bg-ai-subtle px-3 py-2.5 text-[13.5px] font-medium text-ai-subtle-foreground"
          >
            <Spinner className="size-3.5 text-ai" />
            {t.stale}
          </div>
        ) : null}
        <p className="flex items-start gap-2 text-[13px] font-medium text-secondary-foreground">
          <Icon icon={InformationCircleIcon} className="mt-0.5 size-3.5 text-ai" />
          <span>{t.disclaimer}</span>
        </p>
        {stale ? (
          <div aria-hidden="true" inert className="grid gap-3.5 opacity-45 select-none">
            {children}
          </div>
        ) : (
          children
        )}
      </PanelBody>
    </TabsContent>
  );
}

export function Callout({
  tone,
  icon,
  action,
  children,
}: {
  tone: 'warning' | 'neutral';
  icon: Parameters<typeof Icon>[0]['icon'];
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'warning' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm leading-normal',
        tone === 'warning'
          ? 'bg-warning-subtle text-warning-subtle-foreground'
          : 'bg-muted text-secondary-foreground',
      )}
    >
      <Icon icon={icon} className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** The session ended: nothing more loads until the user signs in again, back to this page. */
export function SessionEnded() {
  return (
    <Callout
      tone="warning"
      icon={Alert02Icon}
      action={
        <RetryButton
          onClick={() => {
            goToSignIn();
          }}
        >
          {t.signIn}
        </RetryButton>
      }
    >
      {t.sessionEnded}
    </Callout>
  );
}

export function RetryButton({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="secondary"
      size="xs"
      className="-my-0.5 [&_svg]:size-[13px]"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={RefreshIcon} />
      {children}
    </Button>
  );
}

export function Block({
  title,
  label,
  rating,
  children,
}: {
  title: string;
  label: CopilotAiLabel;
  /** The block's own rating (`Rating`), under its content. */
  rating?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-2 border-t pt-3.5 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div className="flex min-h-7 items-center gap-2">
        <h3 id={headingId} className="text-[13.5px] font-semibold">
          {title}
        </h3>
        <AiLabel size="sm" text={t.labelShort} details={label} />
      </div>
      {children}
      {rating}
    </section>
  );
}

export function Refs({
  refs,
  resolveRef,
  onOpenSource,
}: {
  refs: CopilotSourceRef[];
  resolveRef: ResolveRef;
  onOpenSource: OpenSource;
}) {
  const resolved = refs.flatMap((ref) => {
    const one = resolveRef(ref);
    return one ? [one] : [];
  });
  if (resolved.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {resolved.map((one) => (
        <SourceRefLink
          key={one.anchorId}
          sourceRef={one.ref}
          label={one.label}
          detail={one.detail}
          targetLabel={one.targetLabel}
          onOpen={() => {
            onOpenSource(one);
          }}
        />
      ))}
    </div>
  );
}

export const textClassName = 'text-sm leading-[1.55] text-foreground';
export const quietClassName = 'text-[13.5px] text-muted-foreground';
