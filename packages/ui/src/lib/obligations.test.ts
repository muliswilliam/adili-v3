import { describe, expect, it } from 'vitest';

import {
  obligationCycleLabel,
  obligationStatusLabel,
  obligationStatusMeta,
  obligationTypeLabel,
  obligationTypeNames,
  obligationTypeShortLabel,
  reminderChannelsLabel,
  reminderOffsetLabel,
  type ReminderOutcome,
  reminderOutcomeLabel,
  reminderOutcomeMeta,
  remindersSentLabel,
} from './obligations';

describe('obligationTypeLabel', () => {
  it('names each type, with the cycle year for a biennial declaration', () => {
    expect(obligationTypeLabel('initial', '2027-03-10')).toBe('Initial declaration');
    expect(obligationTypeLabel('biennial', '2027-11-01')).toBe('Biennial declaration 2027');
    expect(obligationTypeLabel('final', '2027-09-15')).toBe('Final declaration');
  });
});

describe('obligationTypeShortLabel', () => {
  it('names each type briefly, with the cycle year for a biennial declaration', () => {
    expect(obligationTypeShortLabel('initial', '2027-03-10')).toBe('Initial');
    expect(obligationTypeShortLabel('biennial', '2027-11-01')).toBe('Biennial 2027');
    expect(obligationTypeShortLabel('final', '2027-09-15')).toBe('Final');
    expect(obligationTypeNames).toEqual({
      initial: 'Initial',
      biennial: 'Biennial',
      final: 'Final',
    });
  });
});

describe('obligationCycleLabel', () => {
  it('says what started the duty', () => {
    expect(obligationCycleLabel('initial', '2027-03-10')).toBe('Appointment on 10 Mar 2027');
    expect(obligationCycleLabel('biennial', '2029-11-01')).toBe('Biennial 2029');
    expect(obligationCycleLabel('final', '2027-09-15')).toBe('Exit on 15 Sep 2027');
  });
});

describe('obligationStatusMeta', () => {
  it('gives every status a word and a badge variant', () => {
    expect(obligationStatusMeta).toMatchObject({
      upcoming: { label: 'Upcoming', variant: 'neutral' },
      due: { label: 'Due', variant: 'info' },
      overdue: { label: 'Overdue', variant: 'warning' },
      filed: { label: 'Filed', variant: 'success' },
      cancelled: { label: 'Cancelled', variant: 'neutral' },
    });
  });

  it('marks cancelled with its own icon rather than the upcoming clock', () => {
    expect(obligationStatusMeta.cancelled.icon).toBeDefined();
    expect(obligationStatusMeta.upcoming.icon).toBeUndefined();
  });
});

describe('obligationStatusLabel', () => {
  it('words every status, cancelled too', () => {
    expect(obligationStatusLabel('overdue')).toBe('Overdue');
    expect(obligationStatusLabel('cancelled')).toBe('Cancelled');
  });
});

describe('reminderOutcomeLabel', () => {
  it('describes every outcome in plain words', () => {
    expect(reminderOutcomeLabel('sent', ['sms', 'email'])).toBe('Sent by SMS and email');
    expect(reminderOutcomeLabel('sent', ['sms'])).toBe('Sent by SMS');
    expect(reminderOutcomeLabel('sent', ['email'])).toBe('Sent by email');
    expect(reminderOutcomeLabel('skipped-not-onboarded', [])).toBe('Skipped: not yet onboarded');
    expect(reminderOutcomeLabel('skipped-no-contact', [])).toBe('Skipped: no contact details');
    expect(reminderOutcomeLabel('skipped-past-due-at-creation', [])).toBe(
      'Skipped: the date had passed when this obligation was created',
    );
    expect(reminderOutcomeLabel('skipped-missed', [])).toBe('Missed: not sent on its day');
    expect(reminderOutcomeLabel('failed', ['sms'])).toBe('Failed');
  });
});

describe('reminderOutcomeMeta', () => {
  it('colours sent green, failed and missed red and every deliberate skip muted', () => {
    const tones: Record<ReminderOutcome, string> = {
      sent: 'text-success',
      failed: 'text-destructive',
      'skipped-missed': 'text-destructive',
      'skipped-not-onboarded': 'text-muted-foreground',
      'skipped-no-contact': 'text-muted-foreground',
      'skipped-past-due-at-creation': 'text-muted-foreground',
    };
    for (const [outcome, tone] of Object.entries(tones)) {
      expect(reminderOutcomeMeta[outcome as ReminderOutcome].iconClassName).toBe(tone);
    }
    expect(reminderOutcomeMeta.failed.icon).not.toBe(reminderOutcomeMeta.sent.icon);
    expect(reminderOutcomeMeta.failed.icon).not.toBe(
      reminderOutcomeMeta['skipped-no-contact'].icon,
    );
  });
});

describe('reminder labels', () => {
  it('prints offsets, channels and the count sent', () => {
    expect(reminderOffsetLabel(30)).toBe('30 days before');
    expect(reminderOffsetLabel(1)).toBe('1 day before');
    expect(reminderChannelsLabel(['sms', 'email'])).toBe('SMS, Email');
    expect(reminderChannelsLabel([])).toBe('-');
    expect(remindersSentLabel(0)).toBe('No reminders sent yet');
    expect(remindersSentLabel(1)).toBe('1 reminder sent');
    expect(remindersSentLabel(2)).toBe('2 reminders sent');
  });
});
