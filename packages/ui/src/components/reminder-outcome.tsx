import { cn } from '../lib/cn';
import {
  type ReminderChannel,
  type ReminderOutcome as Outcome,
  reminderOutcomeLabel,
  reminderOutcomeMeta,
} from '../lib/obligations';
import { Icon } from './icon';

/**
 * A reminder's outcome in plain words ("Sent by SMS and email", "Skipped: not yet onboarded",
 * "Failed") after a small icon in its tone (`reminderOutcomeMeta`). The words carry the meaning;
 * the icon is decorative.
 */
export function ReminderOutcomeText({
  outcome,
  channels,
  className,
}: {
  outcome: Outcome;
  channels: readonly ReminderChannel[];
  className?: string;
}) {
  const meta = reminderOutcomeMeta[outcome];
  return (
    <span className={cn('inline-flex items-start gap-1.5', className)}>
      <Icon
        icon={meta.icon}
        strokeWidth={2.2}
        className={cn('mt-0.5 size-3.5 shrink-0', meta.iconClassName)}
      />
      <span>{reminderOutcomeLabel(outcome, channels)}</span>
    </span>
  );
}
