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
    expect(failureReasonText('output-purged')).toBe('the output expired before it was saved');
    expect(failureReasonText('cancelled')).toBe('the request was cancelled');
    // The review service's own reasons too (review.yaml `CopilotView.failureReason`).
    expect(failureReasonText('rejected')).toBe('the AI service refused the request');
    expect(failureReasonText('ai-gateway-unavailable')).toBe('AI service unavailable');
    expect(failureReasonText('declarations-unavailable')).toBe('the declaration could not be read');
    expect(failureReasonText('key-service-unavailable')).toBe(
      'the Commission key service is unavailable',
    );
    expect(failureReasonText('internal-error')).toBe('an error in the review service');
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
    {
      versionId: 'v1',
      version: 1,
      submittedAt: '',
      late: false,
      amendment: false,
      firstOnAdili: true,
    },
    {
      versionId: 'v2',
      version: 2,
      submittedAt: '',
      late: false,
      amendment: true,
      firstOnAdili: false,
    },
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

  it('knows a first declaration by the version the output is for (e2e 18)', () => {
    const versions = [
      {
        versionId: 'v1',
        version: 1,
        submittedAt: '',
        late: false,
        amendment: false,
        firstOnAdili: true,
      },
      {
        versionId: 'v2',
        version: 2,
        submittedAt: '',
        late: false,
        amendment: true,
        firstOnAdili: false,
      },
    ];
    // Version 1's output, stale after the amendment, had nothing to compare.
    expect(hasPreviousDeclaration(versions, 'v1')).toBe(false);
    expect(hasPreviousDeclaration(versions, 'v2')).toBe(true);
    // No output yet: the current version.
    expect(hasPreviousDeclaration(versions, null)).toBe(true);
    expect(hasPreviousDeclaration(versions.slice(0, 1), null)).toBe(false);
    expect(hasPreviousDeclaration([], null)).toBe(true);
  });
});
