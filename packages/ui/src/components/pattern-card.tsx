import {
  BalanceScaleIcon,
  BanIcon,
  ChartLineData01Icon,
  Clock01Icon,
  DashboardSpeed01Icon,
  Message01Icon,
  PlusSignIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Badge } from './badge';
import { Button } from './button';
import { Icon, type IconProps } from './icon';
import { Skeleton } from './skeleton';

/** reporting.yaml `PatternCandidate.kind`, in the order candidates are listed. */
export const PATTERN_CANDIDATE_KINDS = [
  'rate-change',
  'threshold-breach',
  'chronic-late-reporting',
  'clarification-ratio-outlier',
  'size-band-outlier',
  'non-reporting',
] as const;

export type PatternCandidateKind = (typeof PATTERN_CANDIDATE_KINDS)[number];

export interface PatternCandidateKindCopy {
  /** The badge's words. */
  label: string;
  /** What makes a pattern of this kind notable, in the badge's title. */
  description: string;
}

export const PATTERN_CANDIDATE_KIND_COPY: Record<PatternCandidateKind, PatternCandidateKindCopy> = {
  'rate-change': {
    label: 'Rate change',
    description: 'A non-filer rate that moved sharply since last year',
  },
  'threshold-breach': {
    label: 'Above threshold',
    description: 'A non-filer rate above the threshold',
  },
  'chronic-late-reporting': {
    label: 'Repeatedly late',
    description: 'Form M submitted late year after year, this year included',
  },
  'clarification-ratio-outlier': {
    label: 'High clarifications',
    description: 'Clarifications per declaration far above the national ratio',
  },
  'size-band-outlier': {
    label: 'Size-band outlier',
    description: 'A non-filer rate far above that of Commissions of a similar size',
  },
  'non-reporting': {
    label: 'Did not report',
    description: 'No Form M received for the year',
  },
};

const KIND_ICONS: Record<PatternCandidateKind, IconProps['icon']> = {
  // A line, not an arrow: a rate change is either way (doubled or halved).
  'rate-change': ChartLineData01Icon,
  'threshold-breach': DashboardSpeed01Icon,
  'chronic-late-reporting': Clock01Icon,
  'clarification-ratio-outlier': Message01Icon,
  'size-band-outlier': BalanceScaleIcon,
  'non-reporting': BanIcon,
};

export interface PatternCardMessages {
  /** The card's accessible name. */
  name: (kindLabel: string, subject: string) => string;
  /** Replaces any kind's label or description. */
  kinds: Partial<Record<PatternCandidateKind, PatternCandidateKindCopy>>;
  /** The cite button's words. */
  cite: string;
  /** The cite button's accessible name, so each card's button says which pattern it cites. */
  citeName: (kindLabel: string, subject: string) => string;
  /** Shown once the pattern is cited, and announced when it becomes so. */
  cited: string;
  /** The cited button's accessible name. */
  citedName: (kindLabel: string, subject: string) => string;
}

export const PATTERN_CARD_MESSAGES: PatternCardMessages = {
  name: (kindLabel, subject) => `${kindLabel}: ${subject}`,
  kinds: {},
  cite: 'Cite in findings',
  citeName: (kindLabel, subject) => `Cite in findings: ${kindLabel}, ${subject}`,
  cited: 'Cited in findings',
  citedName: (kindLabel, subject) => `Cited in findings: ${kindLabel}, ${subject}`,
};

const cardClassName = 'flex min-w-0 flex-col gap-1.5 rounded-xl bg-card px-4 py-3.5';

const citedClassName = 'text-[13px] font-medium text-success [&_svg]:size-3.5';

export type PatternCardProps = Omit<ComponentProps<'article'>, 'children'> & {
  kind: PatternCandidateKind;
  /**
   * Who the pattern is about (`PatternCandidate.subject`: a Commission, an entity type, or
   * `national`), by the name a reader knows: "Nairobi City County Public Service Board",
   * "National". Names the card.
   */
  subject: string;
  /** The main figure, formatted: "12.4%", "3 years", "2 of 47". */
  value: ReactNode;
  /** What the main figure is: "non-filer rate". */
  valueLabel?: ReactNode;
  /** What it compares with: "from 6.1% in 2026", "national ratio 0.8". */
  comparison?: ReactNode;
  /** Offers "Cite in findings". Left out where the narrative cannot be edited. */
  onCite?: () => void;
  /** The findings already cite it: "Cited in findings" in place of the offer. */
  cited?: boolean;
  /** Replaces the cite action with anything else. */
  action?: ReactNode;
  messages?: Partial<PatternCardMessages>;
};

/**
 * A notable pattern the reporting service computed (`PatternCandidate`): its kind as a badge (icon
 * and words, the kind explained in the title), the subject, the main figure in 22px with what it
 * is, the comparison, then the action: "Cite in findings", "Cited in findings" or the `action`
 * slot. Citing keeps the same button, now `aria-disabled` and green, so focus stays on it, and a
 * status announces it. The caller formats the figures from the candidate's `values`.
 */
export function PatternCard({
  kind,
  subject,
  value,
  valueLabel,
  comparison,
  onCite,
  cited = false,
  action,
  messages,
  className,
  ...props
}: PatternCardProps) {
  const copy = { ...PATTERN_CARD_MESSAGES, ...messages };
  const kindCopy = copy.kinds[kind] ?? PATTERN_CANDIDATE_KIND_COPY[kind];

  const footer = action ?? citeAction();

  function citeAction() {
    if (onCite) {
      return (
        <>
          <Button
            variant={cited ? 'ghost' : 'secondary'}
            size="sm"
            aria-disabled={cited || undefined}
            aria-label={(cited ? copy.citedName : copy.citeName)(kindCopy.label, subject)}
            onClick={cited ? undefined : onCite}
            className={cn(
              cited &&
                `-ml-2 cursor-default px-2 hover:bg-transparent hover:text-success active:translate-y-0 ${citedClassName}`,
            )}
          >
            <Icon icon={cited ? Tick02Icon : PlusSignIcon} strokeWidth={cited ? 2.4 : undefined} />
            {cited ? copy.cited : copy.cite}
          </Button>
          <span role="status" className="sr-only">
            {cited ? copy.cited : ''}
          </span>
        </>
      );
    }
    if (!cited) return null;
    return (
      // As tall as the button it stands for, so a card keeps its height read only.
      <span className={cn('inline-flex h-[34px] items-center gap-1.5', citedClassName)}>
        <Icon icon={Tick02Icon} strokeWidth={2.4} />
        {copy.cited}
      </span>
    );
  }

  return (
    <article
      aria-label={copy.name(kindCopy.label, subject)}
      data-kind={kind}
      data-cited={cited || undefined}
      className={cn(cardClassName, cited ? 'shadow-card-cited' : 'shadow-card-flat', className)}
      {...props}
    >
      <div>
        <Badge title={kindCopy.description} className="pl-[7px]">
          <Icon icon={KIND_ICONS[kind]} />
          {kindCopy.label}
        </Badge>
      </div>
      <p className="mt-1 text-[14.5px] leading-[1.35] font-semibold">{subject}</p>
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="text-[22px] font-semibold tracking-[-0.01em] tabular-nums">{value}</span>
        {valueLabel ? (
          <span className="text-[13px] text-muted-foreground">{valueLabel}</span>
        ) : null}
      </p>
      {comparison ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground tabular-nums">
          {comparison}
        </div>
      ) : null}
      {footer ? <div className="mt-auto pt-2">{footer}</div> : null}
    </article>
  );
}

/** A pattern card's shape while the candidates load. Mark the loading region `aria-busy`. */
export function PatternCardSkeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(cardClassName, 'min-h-[150px] shadow-card-flat', className)}
      {...props}
    >
      <Skeleton className="h-5 w-2/5 rounded-full" />
      <Skeleton className="mt-2 w-[70%]" />
      <Skeleton className="mt-1.5 h-[22px] w-[35%]" />
      <Skeleton className="w-4/5" />
    </div>
  );
}
