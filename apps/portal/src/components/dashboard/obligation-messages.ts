/**
 * Copy of the dashboard's obligations (spec 04 frontend, FE-2). Type labels, status words and
 * reminder outcomes are shared with the console and live in @adili/ui (`obligationMessages`).
 * One English string per key; the Swahili slot stays empty until EACC reviews translations.
 */
export const en = {
  heading: 'Your declarations',
  loading: 'Loading your declarations',
  emptyTitle: 'No obligations yet',
  emptyText:
    "Your Commission's roster shows no declaration due for you right now. Obligations appear here when a cycle opens or when your appointment or exit creates one.",
  errorTitle: 'Your obligations could not be loaded',
  errorDetail: 'Check your connection and try again.',
  tryAgain: 'Try again',
  sessionEndedTitle: 'Your session has ended',
  sessionEndedText: 'Sign in again to see your declarations.',
  signInAgain: 'Sign in again',
  statementDate: 'Statement date',
  statementDateTip: 'The date your financial position is declared as at.',
  due: 'Due',
  dueDate: 'Due date',
  cycle: 'Cycle',
  reminders: 'Reminders',
  overdueLead: 'Overdue.',
  overdueText: 'If you have already declared by other means, contact your Commission.',
  startDeclaration: 'Start declaration',
  filingOpensSoon: 'Filing opens soon. You will be reminded.',
  details: 'Details',
  detailsOf: (title: string) => ` of ${title}`,
  close: 'Close',
  reminderSchedule: (commission: string) => `Reminder schedule set by ${commission}.`,
  reminderHistory: 'Reminder history',
  noReminders: 'No reminders sent yet.',
  historyErrorTitle: 'Reminder history could not be loaded',
  historyNotFound:
    'This obligation is no longer available. Reload the page to see your current obligations.',
  whenColumn: 'When',
  scheduledColumn: 'Scheduled',
  sentColumn: 'Sent',
  channelsColumn: 'Channels',
  outcomeColumn: 'Outcome',
  notSent: '-',
};

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
