import { describe, expect, it } from 'vitest';

import { readCopilotView } from '../../../server/copilot.server';
import { mockFlags, mockSummary } from '../../../server/review/copilot-mock.server';
import {
  budgetResetDate,
  failureReasonText,
  hasPreviousDeclaration,
  launcherStatus,
  sortFlags,
  versionNumber,
} from './copilot-view';

const copilot = (status: Parameters<typeof readCopilotView>[0]['status']) =>
  readCopilotView({
    status,
    forVersionId: null,
    generatedAt: null,
    failureReason: null,
    summary: mockSummary('2026-10-01T09:00:00Z'),
    explanations: null,
    jobs: { summarize: null, explain: null },
    feedback: [],
  });

describe('launcherStatus', () => {
  it.each([
    ['ready', 'Summary ready', 'ready'],
    ['pending', 'Preparing summary…', 'busy'],
    ['stale', 'Updating…', 'busy'],
    ['failed', 'Not available', 'warning'],
    ['not-enabled', 'Not enabled', 'off'],
  ] as const)('%s reads "%s"', (status, text, tone) => {
    expect(launcherStatus(copilot(status), null)).toEqual({ text, tone });
  });

  it('is loading until the first read, and not available when it failed', () => {
    expect(launcherStatus(null, null)).toEqual({ text: 'Loading…', tone: 'busy' });
    expect(launcherStatus(null, 'unavailable').text).toBe('Not available');
  });
});

describe('failureReasonText', () => {
  it('puts the job reason in words', () => {
    expect(failureReasonText('provider-unavailable')).toBe('AI service unavailable');
    expect(failureReasonText('refused')).toBe('declined by the AI model');
    expect(failureReasonText('validation')).toBe('output failed its checks');
    expect(failureReasonText('budget')).toBe('monthly AI budget used up');
    expect(failureReasonText('something-new')).toBe('unknown error');
    expect(failureReasonText(null)).toBe('unknown error');
  });
});

describe('budgetResetDate', () => {
  it('is the first of next month in Kenyan time', () => {
    expect(budgetResetDate(new Date('2026-10-14T10:00:00Z'))).toBe('1 Nov 2026');
    // 31 Oct 22:30 UTC is already 1 Nov in Nairobi.
    expect(budgetResetDate(new Date('2026-10-31T22:30:00Z'))).toBe('1 Dec 2026');
    expect(budgetResetDate(new Date('2026-12-05T10:00:00Z'))).toBe('1 Jan 2027');
  });
});

describe('versionNumber', () => {
  const versions = [
    { versionId: 'v1', version: 1, submittedAt: '', late: false, amendment: false },
    { versionId: 'v2', version: 2, submittedAt: '', late: false, amendment: true },
  ];
  it('is the number of the version the copilot was produced for', () => {
    expect(versionNumber('v1', versions)).toBe('1');
    expect(versionNumber('unknown', versions)).toBe('2');
  });
});

describe('flags', () => {
  it('lists open flags by severity, then reviewed ones', () => {
    const titles = sortFlags(mockFlags('v')).map((flag) => flag.severity);
    expect(titles).toEqual(['high', 'medium', 'medium', 'info', 'low']);
  });

  it('knows a first declaration by its rule', () => {
    const flags = mockFlags('v');
    const [one] = flags;
    if (!one) throw new Error('no flags');
    expect(hasPreviousDeclaration(flags)).toBe(true);
    expect(hasPreviousDeclaration([{ ...one, ruleId: 'no-previous-version' }])).toBe(false);
  });
});
