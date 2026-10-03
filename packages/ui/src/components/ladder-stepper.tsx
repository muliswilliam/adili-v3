import {
  BanIcon,
  Cancel01Icon,
  Clock01Icon,
  MinusSignIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { formatDate } from '../lib/format-date';
import { Icon, type IconProps } from './icon';

/**
 * Where one step of an administrative action ladder stands. `upcoming`: not reached yet.
 * `skipped`: the ladder ended before it (the declarant complied). `awaiting`: drafted and waiting
 * for approval, or approved and waiting for payroll. `current`: issued, its window running.
 * `declined`: the approver declined it. `stopped`: a salary stoppage in force. `done`: issued and
 * passed, or complied with.
 */
export type LadderStepStatus =
  'upcoming' | 'skipped' | 'awaiting' | 'current' | 'declined' | 'stopped' | 'done';

export const LADDER_STEP_STATUSES: readonly LadderStepStatus[] = [
  'upcoming',
  'skipped',
  'awaiting',
  'current',
  'declined',
  'stopped',
  'done',
];

export interface LadderStepperStep {
  id: string;
  /** The step's name, e.g. "Notice to comply". */
  label: ReactNode;
  status: LadderStepStatus;
  /**
   * The step's line under its name, e.g. "Issued 3 Sep 2026" or "Awaiting approval · drafted 2
   * Oct 2026". Without it the line is the status word.
   */
  detail?: ReactNode;
  /** When the step's window to comply closes, printed as "Act by {date}". */
  windowEndsAt?: string;
  /** The letter the step issued, e.g. its reference or a link to it. */
  letter?: ReactNode;
  /** The declarant's response to the step, e.g. "Responded 9 Aug 2026". */
  response?: ReactNode;
}

export interface LadderStepperMessages {
  /** The ladder's name for screen readers. Defaults to "Administrative action ladder". */
  label: string;
  /** Read before a step's status word. Defaults to "Status". */
  statusPrefix: string;
  statuses: Record<LadderStepStatus, string>;
  /** Defaults to "Act by {date}". */
  windowEndsAt: (date: string) => string;
}

export const LADDER_STEPPER_MESSAGES: LadderStepperMessages = {
  label: 'Administrative action ladder',
  statusPrefix: 'Status',
  statuses: {
    upcoming: 'Not started',
    skipped: 'Not needed',
    awaiting: 'Awaiting approval',
    current: 'In progress',
    declined: 'Declined',
    stopped: 'Salary stopped',
    done: 'Done',
  },
  windowEndsAt: (date) => `Act by ${date}`,
};

const MARKER: Record<LadderStepStatus, { className: string; icon?: IconProps['icon'] }> = {
  upcoming: { className: 'bg-card text-muted-foreground inset-ring-[1.5px] inset-ring-input' },
  skipped: { className: 'bg-muted text-muted-foreground', icon: MinusSignIcon },
  awaiting: {
    className: 'bg-warning-subtle text-warning inset-ring-[1.5px] inset-ring-warning/40',
    icon: Clock01Icon,
  },
  current: {
    className: 'bg-primary text-primary-foreground ring-4 ring-primary/10',
  },
  declined: {
    className:
      'bg-destructive-subtle text-destructive inset-ring-[1.5px] inset-ring-destructive/35',
    icon: Cancel01Icon,
  },
  stopped: { className: 'bg-destructive text-destructive-foreground', icon: BanIcon },
  done: { className: 'bg-success text-primary-foreground', icon: Tick02Icon },
};

/** Steps not reached are named in the muted weight, so the ladder's progress reads at a glance. */
const QUIET: ReadonlySet<LadderStepStatus> = new Set(['upcoming', 'skipped']);

export type LadderStepperProps = Omit<ComponentProps<'ol'>, 'children'> & {
  steps: readonly LadderStepperStep[];
  /** Names the list for screen readers; defaults to "Administrative action ladder". */
  label?: string;
  messages?: Partial<Omit<LadderStepperMessages, 'statuses'>> & {
    statuses?: Partial<LadderStepperMessages['statuses']>;
  };
};

/**
 * An administrative action ladder (notice to comply, warning, salary stoppage, disciplinary
 * referral) as one row of numbered steps: each with its name, a status line (`detail`, or the
 * status word), when its window ends, the letter it issued and the declarant's response. The
 * number turns into a tick, a clock, a cross or a ban sign by status, and screen readers hear
 * "Status: {word}." with each step, so the status is never colour alone. The step the ladder is
 * on carries `aria-current="step"`. Below 700px of container width the steps stack, joined by a
 * vertical rule.
 */
export function LadderStepper({
  steps,
  label,
  messages,
  className,
  style,
  ...props
}: LadderStepperProps) {
  const copy = {
    ...LADDER_STEPPER_MESSAGES,
    ...messages,
    statuses: { ...LADDER_STEPPER_MESSAGES.statuses, ...messages?.statuses },
  };
  return (
    <div className="@container">
      <ol
        aria-label={label ?? copy.label}
        className={cn(
          'grid grid-cols-1 @min-[700px]:grid-cols-[repeat(var(--ladder-steps),minmax(0,1fr))]',
          className,
        )}
        style={{ '--ladder-steps': steps.length, ...style } as CSSProperties}
        {...props}
      >
        {steps.map((step, index) => {
          const marker = MARKER[step.status];
          const word = copy.statuses[step.status];
          const last = index === steps.length - 1;
          return (
            <li
              key={step.id}
              data-status={step.status}
              aria-current={step.status === 'current' ? 'step' : undefined}
              className={cn(
                'relative grid grid-cols-[28px_minmax(0,1fr)] content-start gap-x-3 pb-3.5',
                '@min-[700px]:grid-cols-1 @min-[700px]:gap-y-1.5 @min-[700px]:pr-3.5 @min-[700px]:pb-0',
              )}
            >
              {last ? null : (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute top-8 bottom-0.5 left-[13px] w-0.5 rounded-full',
                    '@min-[700px]:top-[13px] @min-[700px]:right-2 @min-[700px]:bottom-auto @min-[700px]:left-9 @min-[700px]:h-0.5 @min-[700px]:w-auto',
                    step.status === 'done' ? 'bg-success/35' : 'bg-border',
                  )}
                />
              )}
              <span
                data-marker=""
                aria-hidden="true"
                className={cn(
                  'relative z-[1] row-span-5 flex size-7 items-center justify-center rounded-full text-[12.5px] font-semibold tabular-nums @min-[700px]:row-span-1',
                  marker.className,
                )}
              >
                {marker.icon ? (
                  <Icon icon={marker.icon} strokeWidth={2.4} className="size-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                data-label=""
                className={cn(
                  'text-sm leading-[1.3]',
                  QUIET.has(step.status) ? 'font-medium text-muted-foreground' : 'font-semibold',
                )}
              >
                {step.label}
              </span>
              {step.detail === undefined ? (
                <span className="text-[12.5px] leading-[1.35] text-muted-foreground">{word}</span>
              ) : (
                <span className="text-[12.5px] leading-[1.35] text-muted-foreground">
                  <span className="sr-only">{`${copy.statusPrefix}: ${word}. `}</span>
                  {step.detail}
                </span>
              )}
              {step.windowEndsAt === undefined ? null : (
                <span className="text-[12.5px] leading-[1.35] text-muted-foreground">
                  {copy.windowEndsAt(formatDate(step.windowEndsAt))}
                </span>
              )}
              {step.letter === undefined && step.response === undefined ? null : (
                <span className="grid gap-0.5 text-[12.5px] leading-[1.35] text-secondary-foreground">
                  {step.letter === undefined ? null : (
                    <span className="truncate font-mono">{step.letter}</span>
                  )}
                  {step.response === undefined ? null : <span>{step.response}</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
