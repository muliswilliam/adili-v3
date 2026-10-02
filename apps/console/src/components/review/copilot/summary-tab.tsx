import { cn, focusRing } from '@adili/ui';
import type { ReactNode } from 'react';

import type { CopilotSourceRef, CopilotSummary } from '../../../server/copilot.server';
import type { Flag } from '../../../server/review/types';
import {
  Block,
  type OpenSource,
  quietClassName,
  Refs,
  type ResolveRef,
  textClassName,
} from './panel-parts';
import type { SummaryBlock } from './copilot-view';
import { messages as t } from './messages';
import { SeverityBadge } from './severity-badge';

/** The Summary tab: overview, changes since the previous version, by person, worth attention. */
export function SummaryTab({
  summary,
  flags,
  resolveRef,
  hasPrevious,
  onOpenSource,
  onOpenFlag,
  rate,
}: {
  summary: CopilotSummary;
  flags: Flag[];
  resolveRef: ResolveRef;
  hasPrevious: boolean;
  onOpenSource: OpenSource;
  onOpenFlag: (flagId: string) => void;
  /** The rating of one block, named by `group`. */
  rate: (block: SummaryBlock, group: string) => ReactNode;
}) {
  const { label } = summary;
  const refs = (list: CopilotSourceRef[]) => (
    <Refs refs={list} resolveRef={resolveRef} onOpenSource={onOpenSource} />
  );
  const flagById = new Map(flags.map((flag) => [flag.id, flag]));
  return (
    <>
      <Block title={t.blocks.overview} label={label} rating={rate('overview', t.rate.overview)}>
        <p className={textClassName}>{summary.overview}</p>
      </Block>
      <Block title={t.blocks.changes} label={label} rating={rate('changes', t.rate.changes)}>
        {summary.changesSincePrevious.length > 0 ? (
          <ul className="grid gap-3">
            {summary.changesSincePrevious.map((change) => (
              <li key={change.text} className={textClassName}>
                {change.text}
                {refs(change.refs)}
              </li>
            ))}
          </ul>
        ) : (
          <p className={quietClassName}>{hasPrevious ? t.noChanges : t.firstDeclaration}</p>
        )}
      </Block>
      {summary.sections.length > 0 ? (
        <Block title={t.blocks.sections} label={label} rating={rate('sections', t.rate.sections)}>
          <div className="grid gap-2.5">
            {summary.sections.map((section) => {
              const head = resolveRef({
                sectionKey: section.sectionKey,
                personKey: null,
                itemId: null,
                fieldPath: null,
              });
              return (
                <div key={section.sectionKey}>
                  {head ? (
                    <div className="mb-0.5 text-[12.5px] font-semibold text-muted-foreground">
                      {head.label}
                    </div>
                  ) : null}
                  <p className={textClassName}>{section.text}</p>
                  {refs(section.refs)}
                </div>
              );
            })}
          </div>
        </Block>
      ) : null}
      <Block
        title={t.blocks.attention}
        label={label}
        rating={rate('worth-attention', t.rate.attention)}
      >
        {summary.worthAttention.length > 0 ? (
          <ul className="grid gap-3">
            {summary.worthAttention.map((point) => (
              <li key={point.text} className={textClassName}>
                {point.text}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {point.flagIds.flatMap((flagId) => {
                    const flag = flagById.get(flagId);
                    return flag ? [<FlagLink key={flagId} flag={flag} onOpen={onOpenFlag} />] : [];
                  })}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={quietClassName}>{t.noAttention}</p>
        )}
      </Block>
    </>
  );
}

/** A flag named in "Worth attention": opens its explanation on the Flags tab. */
export function FlagLink({ flag, onOpen }: { flag: Flag; onOpen: (flagId: string) => void }) {
  return (
    <button
      type="button"
      aria-label={t.openFlag(flag.title)}
      onClick={() => {
        onOpen(flag.id);
      }}
      className={cn(
        focusRing,
        'inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full py-0.5 pr-2 pl-[3px] text-[12.5px] font-medium text-foreground ring-1 ring-border hover:ring-secondary-foreground',
      )}
    >
      <SeverityBadge severity={flag.severity} size="sm" />
      <span className="truncate">{flag.title}</span>
    </button>
  );
}
