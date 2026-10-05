import { describe, expect, it } from 'vitest';

import type { ComplianceReport, ReportPeriod } from '../../server/reporting/types';
import {
  dueLine,
  isPreview,
  manualMissing,
  partIMissing,
  periodLine,
  signOffSteps,
} from './form-m-view';

const period = (over: Partial<ReportPeriod>): ReportPeriod => ({
  fy: 2025,
  status: 'not-started',
  dueDate: '2026-07-31',
  reference: null,
  submittedAt: null,
  late: null,
  previewAvailable: false,
  ...over,
});

describe('the period line under each financial year', () => {
  it('says when a year without a report can be previewed, and its due date', () => {
    expect(periodLine(period({ fy: 2026, dueDate: '2027-07-31' }), '2026-10-03')).toBe(
      'Preview from 1 Apr 2027 · Due 31 Jul 2027',
    );
    expect(
      periodLine(period({ fy: 2026, dueDate: '2027-07-31', previewAvailable: true }), '2027-04-10'),
    ).toBe('Preview available · Due 31 Jul 2027');
  });

  it('reads a past year that never got a report as due or overdue, not as a preview', () => {
    // The service still says previewAvailable: compiling is open from 1 April with no end.
    const past = period({ previewAvailable: true });
    expect(periodLine(past, '2026-10-03')).toBe('Was due 31 Jul 2026 · 64 days overdue');
    expect(periodLine(past, '2026-07-10')).toBe('Due 31 Jul 2026 · 21 days left');
    expect(periodLine(past, '2026-06-30')).toBe('Preview available · Due 31 Jul 2026');
  });

  it('counts the days left, or overdue, for a report in progress', () => {
    expect(periodLine(period({ status: 'draft' }), '2026-10-03')).toBe(
      'Was due 31 Jul 2026 · 64 days overdue',
    );
    expect(
      periodLine(period({ fy: 2026, status: 'compiling', dueDate: '2027-07-31' }), '2027-04-10'),
    ).toBe('Due 31 Jul 2027 · 112 days left');
    expect(periodLine(period({ status: 'draft' }), '2026-07-30')).toBe(
      'Due 31 Jul 2026 · 1 day left',
    );
  });

  it('says when a submitted report was filed, and that it was late', () => {
    expect(
      periodLine(
        period({ status: 'submitted', submittedAt: '2026-09-26T11:42:00Z', late: true }),
        '2027-04-10',
      ),
    ).toBe('Submitted 26 Sep 2026 (late)');
    expect(
      periodLine(
        period({ status: 'submitted', submittedAt: '2026-07-20T08:00:00Z', late: false }),
        '2027-04-10',
      ),
    ).toBe('Submitted 20 Jul 2026');
  });
});

describe('the footer due line', () => {
  it('names the due date in full with the days left or overdue', () => {
    expect(dueLine('2026-07-31', '2026-10-03')).toEqual({
      text: 'Due 31 July 2026 · 64 days overdue',
      tone: 'destructive',
    });
    expect(dueLine('2027-07-31', '2027-07-20')).toEqual({
      text: 'Due 31 July 2027 · 11 days left',
      tone: 'warning',
    });
    expect(dueLine('2027-07-31', '2027-04-10')).toEqual({
      text: 'Due 31 July 2027 · 112 days left',
      tone: 'neutral',
    });
  });
});

const report = (over: Partial<ComplianceReport>): ComplianceReport =>
  ({
    fy: 2025,
    status: 'draft',
    compiledAt: '2026-09-22T03:00:00.000Z',
    reviewedBy: null,
    confirmedBy: null,
    submittedAt: null,
    ...over,
  }) as ComplianceReport;

describe('a preview', () => {
  it('is a report compiled before its financial year ended (Nairobi time)', () => {
    expect(isPreview(report({ fy: 2026, compiledAt: '2027-04-10T06:00:00Z' }))).toBe(true);
    expect(isPreview(report({ fy: 2026, compiledAt: '2027-06-30T20:59:00Z' }))).toBe(true);
    expect(isPreview(report({ fy: 2026, compiledAt: '2027-06-30T21:00:00Z' }))).toBe(false);
    expect(isPreview(report({ fy: 2025 }))).toBe(false);
  });
});

const partI = (contactDetails: string, physicalAddress: string, emailAddress: string) =>
  ({ partI: { contactDetails, physicalAddress, emailAddress } }) as ComplianceReport['document'] &
    object;

describe('Part I', () => {
  it('lists the contact fields still blank, and an email that is not one', () => {
    expect(partIMissing(partI('', 'Harambee Avenue', ''))).toEqual([
      'contact details',
      'email address',
    ]);
    expect(partIMissing(partI('+254 20 222 3901', ' ', 'compliance@psc'))).toEqual([
      'physical address',
      'a valid email address',
    ]);
    expect(partIMissing(partI('+254 20 222 3901', 'Harambee Avenue', 'form-m@psc.go.ke'))).toEqual(
      [],
    );
  });
});

describe('what the commission-admin has still to fill', () => {
  it('adds the unanswered Part B register question to the Part I fields', () => {
    const document = (registerMaintained: boolean | null) =>
      ({
        partI: {
          contactDetails: '+254 20 222 3901',
          physicalAddress: 'Harambee Avenue',
          emailAddress: 'form-m@psc.go.ke',
        },
        partII: { complaints: { registerMaintained, items: [] } },
      }) as unknown as NonNullable<ComplianceReport['document']>;
    expect(manualMissing(document(null))).toEqual(['Part B register answer']);
    expect(manualMissing(document(false))).toEqual([]);
  });
});

describe('the sign-off steps', () => {
  it('marks the draft compiled and the supervisor review as next', () => {
    const steps = signOffSteps(report({}), ['contact details', 'email address']);
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ['compiled', 'done'],
      ['reviewed', 'current'],
      ['filled', 'upcoming'],
      ['submitted', 'upcoming'],
    ]);
    expect(steps[0]).toMatchObject({ label: 'Draft compiled', detail: '22 Sep 2026, 06:00' });
    expect(steps[2]?.detail).toBe('Missing contact details, email address');
  });

  it('names a preview as such', () => {
    const steps = signOffSteps(report({ fy: 2026, compiledAt: '2027-04-10T06:00:00Z' }), []);
    expect(steps[0]?.label).toBe('Preview compiled');
  });

  it('moves on to Part I once reviewed, then to confirmation once it is filled', () => {
    const reviewed = report({
      status: 'reviewed',
      reviewedBy: { subject: 's', name: 'Samuel Njoroge' },
    });
    expect(signOffSteps(reviewed, ['email address']).map((step) => step.state)).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
    ]);
    expect(signOffSteps(reviewed, []).map((step) => step.state)).toEqual([
      'done',
      'done',
      'done',
      'current',
    ]);
  });

  it('dates the review as the header does, from the Part III signature', () => {
    const reviewed = (date: string | null) =>
      report({
        status: 'reviewed',
        reviewedBy: { subject: 's', name: 'Samuel Njoroge' },
        document: {
          partIII: { compiledBy: { name: 'Samuel Njoroge', date } },
        } as unknown as ComplianceReport['document'],
      });
    expect(signOffSteps(reviewed('2026-09-24'), [])[1]?.detail).toBe('Samuel Njoroge, 24 Sep 2026');
    expect(signOffSteps(reviewed(null), [])[1]?.detail).toBe('Samuel Njoroge');
  });
});
