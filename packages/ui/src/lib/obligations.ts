import {
  AlertCircleIcon,
  Cancel01Icon,
  MinusSignIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';

import type { IconProps } from '../components/icon';
import type { StatusBadgeVariant } from '../components/status-badge';
import { formatDate } from './format-date';

/**
 * The words for filing obligations, shared by the portal and the console (spec 04 frontend:
 * "type labels, status words and reminder outcomes come from one table"). The unions mirror
 * `declarations.yaml`; the apps check their generated types against them.
 */
export type ObligationType = 'initial' | 'biennial' | 'final';

export type ObligationStatus = 'upcoming' | 'due' | 'overdue' | 'filed' | 'cancelled';

export type ReminderOutcome =
  | 'sent'
  | 'skipped-not-onboarded'
  | 'skipped-no-contact'
  | 'skipped-past-due-at-creation'
  | 'failed';

export type ReminderChannel = 'sms' | 'email';

/** One English string per key; the Swahili slot stays empty until EACC reviews translations. */
export const obligationMessages = {
  initial: 'Initial declaration',
  biennial: (year: string) => `Biennial declaration ${year}`,
  final: 'Final declaration',
  typeInitial: 'Initial',
  typeBiennial: 'Biennial',
  typeFinal: 'Final',
  cycleInitial: (date: string) => `Appointment on ${date}`,
  cycleBiennial: (year: string) => `Biennial ${year}`,
  cycleFinal: (date: string) => `Exit on ${date}`,
  upcoming: 'Upcoming',
  due: 'Due',
  overdue: 'Overdue',
  filed: 'Filed',
  cancelled: 'Cancelled',
  sentBoth: 'Sent by SMS and email',
  sentSms: 'Sent by SMS',
  sentEmail: 'Sent by email',
  skippedNotOnboarded: 'Skipped: not yet onboarded',
  skippedNoContact: 'Skipped: no contact details',
  skippedPastDue: 'Skipped: the date had passed when this obligation was created',
  failed: 'Failed',
  sms: 'SMS',
  email: 'Email',
  daysBefore: (days: number) => `${String(days)} ${days === 1 ? 'day' : 'days'} before`,
  reminderHistory: 'Reminder history',
  reminderWhen: 'When',
  reminderScheduled: 'Scheduled',
  reminderSent: 'Sent',
  reminderChannels: 'Channels',
  reminderOutcome: 'Outcome',
  noReminders: 'No reminders sent yet.',
  noValue: '-',
  tryAgain: 'Try again',
  remindersSent: (count: number) =>
    count === 0
      ? 'No reminders sent yet'
      : `${String(count)} ${count === 1 ? 'reminder' : 'reminders'} sent`,
};

/** Swahili translations, key by key; empty until reviewed. */
export const obligationMessagesSw: Partial<Record<keyof typeof obligationMessages, string>> = {};

const m = obligationMessages;

/** "Initial declaration", "Biennial declaration 2027" or "Final declaration". */
export function obligationTypeLabel(type: ObligationType, statementDate: string): string {
  if (type === 'biennial') return m.biennial(statementDate.slice(0, 4));
  return type === 'initial' ? m.initial : m.final;
}

/** The types as short names, e.g. for a filter or a count breakdown. */
export const obligationTypeNames: Record<ObligationType, string> = {
  initial: m.typeInitial,
  biennial: m.typeBiennial,
  final: m.typeFinal,
};

/** The type as a table cell: "Initial", "Biennial 2027" or "Final". */
export function obligationTypeShortLabel(type: ObligationType, statementDate: string): string {
  if (type === 'biennial') return m.cycleBiennial(statementDate.slice(0, 4));
  return obligationTypeNames[type];
}

/** What started the duty: "Appointment on 10 Mar 2027", "Biennial 2027", "Exit on 15 Sep 2027". */
export function obligationCycleLabel(type: ObligationType, statementDate: string): string {
  if (type === 'biennial') return m.cycleBiennial(statementDate.slice(0, 4));
  const date = formatDate(statementDate);
  return type === 'initial' ? m.cycleInitial(date) : m.cycleFinal(date);
}

export interface ObligationStatusMeta {
  label: string;
  variant: StatusBadgeVariant;
  /** Replaces the variant's icon on the badge. */
  icon?: IconProps['icon'];
}

/**
 * The word and `StatusBadge` variant for each status. The declarant's dashboard never lists a
 * `cancelled` obligation; staff may open one, so it has a neutral badge with a cross.
 */
export const obligationStatusMeta: Record<ObligationStatus, ObligationStatusMeta> = {
  upcoming: { label: m.upcoming, variant: 'neutral' },
  due: { label: m.due, variant: 'info' },
  overdue: { label: m.overdue, variant: 'warning' },
  filed: { label: m.filed, variant: 'success' },
  cancelled: { label: m.cancelled, variant: 'neutral', icon: Cancel01Icon },
};

/** A status's word. */
export function obligationStatusLabel(status: ObligationStatus): string {
  return obligationStatusMeta[status].label;
}

/** A reminder's outcome in plain words, naming the channels it went by when sent. */
export function reminderOutcomeLabel(
  outcome: ReminderOutcome,
  channels: readonly ReminderChannel[],
): string {
  switch (outcome) {
    case 'sent': {
      const sms = channels.includes('sms');
      const email = channels.includes('email');
      if (sms && email) return m.sentBoth;
      return sms ? m.sentSms : m.sentEmail;
    }
    case 'skipped-not-onboarded':
      return m.skippedNotOnboarded;
    case 'skipped-no-contact':
      return m.skippedNoContact;
    case 'skipped-past-due-at-creation':
      return m.skippedPastDue;
    case 'failed':
      return m.failed;
  }
}

export interface ReminderOutcomeMeta {
  icon: IconProps['icon'];
  /** The icon's colour. */
  iconClassName: string;
}

/**
 * The icon beside each reminder outcome's words: a green tick when sent, a red alert when
 * sending failed (someone should look), a muted dash when it was skipped on purpose.
 */
export const reminderOutcomeMeta: Record<ReminderOutcome, ReminderOutcomeMeta> = {
  sent: { icon: Tick02Icon, iconClassName: 'text-success' },
  failed: { icon: AlertCircleIcon, iconClassName: 'text-destructive' },
  'skipped-not-onboarded': { icon: MinusSignIcon, iconClassName: 'text-muted-foreground' },
  'skipped-no-contact': { icon: MinusSignIcon, iconClassName: 'text-muted-foreground' },
  'skipped-past-due-at-creation': { icon: MinusSignIcon, iconClassName: 'text-muted-foreground' },
};

/** "30 days before" the due date. */
export function reminderOffsetLabel(days: number): string {
  return m.daysBefore(days);
}

/** "SMS, Email", or "-" when none. */
export function reminderChannelsLabel(channels: readonly ReminderChannel[]): string {
  if (channels.length === 0) return m.noValue;
  return channels.map((channel) => m[channel]).join(', ');
}

/** "No reminders sent yet", "1 reminder sent", "2 reminders sent". */
export function remindersSentLabel(count: number): string {
  return m.remindersSent(count);
}
