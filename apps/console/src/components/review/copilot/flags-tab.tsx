import { AiLabel, Button, cn, EmptyState, focusRingInset, Icon } from '@adili/ui';
import {
  ArrowDown01Icon,
  Flag02Icon,
  InformationCircleIcon,
  Message01Icon,
  PlusSignIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useRef } from 'react';

import type { CopilotAiLabel, CopilotExplanation } from '../../../server/copilot.server';
import type { Flag } from '../../../server/review/types';
import { flagDone, sortFlags } from './copilot-view';
import {
  type FlagSelection,
  type OpenSource,
  quietClassName,
  Refs,
  type ResolveRef,
} from './panel-parts';
import { messages as t } from './messages';
import { SeverityBadge } from './severity-badge';

export const flagAnchor = (flagId: string) => `copilot-flag-${flagId}`;

/** The Flags tab: each flag of the case with its explanation, most severe first. */
export function FlagsTab({
  flags,
  explanations,
  label,
  expanded,
  pulse,
  onToggle,
  resolveRef,
  onOpenSource,
  selection,
  rate,
}: {
  flags: Flag[];
  explanations: CopilotExplanation[];
  label: CopilotAiLabel | null;
  expanded: Record<string, boolean>;
  pulse: string | null;
  onToggle: (flagId: string) => void;
  resolveRef: ResolveRef;
  onOpenSource: OpenSource;
  selection: FlagSelection | undefined;
  /** The rating of one flag's explanation, named by `group`. */
  rate: (flagId: string, group: string) => ReactNode;
}) {
  if (flags.length === 0) {
    return (
      <EmptyState
        icon={<Icon icon={Flag02Icon} />}
        title={t.flags.none}
        description={t.flags.noneDetail}
      />
    );
  }
  const byFlag = new Map(explanations.map((each) => [each.flagId, each]));
  return (
    <>
      <div className="grid gap-2.5">
        {sortFlags(flags).map((flag) => (
          <FlagExplanation
            key={flag.id}
            flag={flag}
            explanation={byFlag.get(flag.id) ?? null}
            label={label}
            open={Boolean(expanded[flag.id])}
            pulse={pulse === flag.id}
            onToggle={() => {
              onToggle(flag.id);
            }}
            resolveRef={resolveRef}
            onOpenSource={onOpenSource}
            selection={selection}
            rating={rate(flag.id, t.rate.explanation(flag.title))}
          />
        ))}
      </div>
    </>
  );
}

/** One flag, collapsed to its title, opening to what it means, what to check and what resolves it. */
export function FlagExplanation({
  flag,
  explanation,
  label,
  open,
  pulse,
  onToggle,
  resolveRef,
  onOpenSource,
  selection,
  rating,
}: {
  flag: Flag;
  explanation: CopilotExplanation | null;
  label: CopilotAiLabel | null;
  open: boolean;
  pulse: boolean;
  onToggle: () => void;
  resolveRef: ResolveRef;
  onOpenSource: OpenSource;
  selection: FlagSelection | undefined;
  /** The explanation's own rating (`Rating`), under it. */
  rating: ReactNode;
}) {
  const bodyId = useId();
  const done = flagDone(flag);
  const added = selection?.flagIds.includes(flag.id) ?? false;
  const canAdd = selection !== undefined && !done;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      id={flagAnchor(flag.id)}
      className={cn(
        'scroll-mt-[150px] overflow-hidden rounded-xl shadow-card',
        pulse && 'animate-[copilot-flag-pulse_1.6s_ease-out] motion-reduce:animate-none',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={onToggle}
        className={cn(
          focusRingInset,
          'flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-[11px] text-left',
        )}
      >
        {done ? (
          <Icon icon={Tick02Icon} strokeWidth={2.4} className="size-[15px] text-success" />
        ) : (
          <SeverityBadge severity={flag.severity} />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 text-[13.5px] leading-[1.35]',
            done ? 'font-medium text-secondary-foreground' : 'font-semibold',
          )}
        >
          {flag.title}
        </span>
        {done ? (
          <span className="text-[13px] text-muted-foreground">
            {flag.closedReason ? t.flags.closed : t.flags.reviewed}
          </span>
        ) : null}
        <Icon
          icon={ArrowDown01Icon}
          className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div id={bodyId} className="grid gap-2.5 px-3.5 pt-0.5 pb-3 text-[13.5px]">
          {explanation ? (
            <>
              <div>
                <div className="mb-0.5 text-xs font-semibold text-muted-foreground">
                  {t.flags.meaning}
                </div>
                <p>{explanation.meaning}</p>
              </div>
              <div>
                <div className="mb-0.5 text-xs font-semibold text-muted-foreground">
                  {t.flags.check}
                </div>
                <ol className="grid list-decimal gap-[3px] pl-[18px]">
                  {explanation.whatToCheck.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
              <div>
                <div className="mb-0.5 text-xs font-semibold text-muted-foreground">
                  {t.flags.resolves}
                </div>
                <p>{explanation.typicalResolution}</p>
              </div>
              <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Icon icon={InformationCircleIcon} className="size-[13px]" />
                {t.flags.notFinding}
              </p>
              <Refs
                refs={explanation.refs.filter((each) => each.itemId)}
                resolveRef={resolveRef}
                onOpenSource={onOpenSource}
              />
              {rating}
            </>
          ) : (
            <p className={quietClassName}>{t.flags.noExplanation}</p>
          )}
          {(explanation && label) || canAdd ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
              {explanation && label ? (
                <AiLabel size="sm" text={t.labelShort} details={label} />
              ) : null}
              <span className="flex-1" />
              {canAdd ? (
                <Button
                  variant={added ? 'secondary' : 'ghost'}
                  size="xs"
                  aria-pressed={added}
                  onClick={() => {
                    selection.onToggle(flag.id);
                  }}
                >
                  <Icon icon={added ? Tick02Icon : PlusSignIcon} />
                  {added ? t.flags.added : t.flags.add}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The flags picked for a clarification, with Clear and New clarification. */
export function SelectionBar({ selection }: { selection: FlagSelection }) {
  if (selection.flagIds.length === 0) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b bg-ai-subtle py-2 pr-3 pl-4 text-[13px] font-semibold text-ai-subtle-foreground"
    >
      <span className="flex-1">{t.flags.selected(selection.flagIds.length)}</span>
      <Button variant="ghost" size="xs" onClick={selection.onClear}>
        {t.flags.clear}
      </Button>
      {selection.onCompose ? (
        <Button size="xs" disabled={selection.composeDisabled} onClick={selection.onCompose}>
          <Icon icon={Message01Icon} />
          {t.flags.newClarification}
        </Button>
      ) : null}
    </div>
  );
}
