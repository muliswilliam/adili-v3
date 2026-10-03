import { describe, expect, it } from 'vitest';

import type { NarrativeParagraph } from '../../server/reporting/types';
import {
  approvalOf,
  defaultReportYear,
  editorValueOf,
  narrativeTextOf,
  ncrSearchSchema,
  newReportsSince,
  reportYears,
} from './model';

const at = (iso: string) => new Date(iso);

describe('report years', () => {
  it('offers every financial year from 2025/2026 to the current one, latest first', () => {
    expect(reportYears(at('2027-10-03T09:00:00Z'))).toEqual([2027, 2026, 2025]);
  });

  it('turns to the new financial year at midnight on 1 July in Nairobi', () => {
    expect(reportYears(at('2026-06-30T20:59:00Z'))).toEqual([2025]);
    expect(reportYears(at('2026-06-30T21:00:00Z'))).toEqual([2026, 2025]);
  });

  it('opens on the year whose reports are in: the one before the current year', () => {
    expect(defaultReportYear(at('2026-10-03T09:00:00Z'))).toBe(2025);
    expect(defaultReportYear(at('2026-03-01T09:00:00Z'))).toBe(2025);
  });

  it('reads the year and page from the address, dropping what is not a year reports exist for', () => {
    expect(ncrSearchSchema.parse({ fy: 2025, page: 2 })).toEqual({ fy: 2025, page: 2 });
    expect(ncrSearchSchema.parse({ fy: 2019, page: 0 })).toEqual({});
  });
});

const para = (
  section: NarrativeParagraph['section'],
  position: number,
  text: string,
): NarrativeParagraph => ({
  id: `${section}-${String(position)}`,
  section,
  position,
  text,
  aiDraft: false,
  aggregateRefs: [],
  candidateIds: [],
});

describe('narrative', () => {
  it('groups the paragraphs by section in position order', () => {
    const value = editorValueOf([
      para('findings', 1, 'B'),
      para('overview', 0, 'O'),
      para('findings', 0, 'A'),
    ]);

    expect(value.overview?.map((each) => each.text)).toEqual(['O']);
    expect(value.findings?.map((each) => each.text)).toEqual(['A', 'B']);
    expect(value.recommendations).toEqual([]);
  });

  it('saves each section as its paragraphs joined by a blank line, empty ones dropped', () => {
    expect(
      narrativeTextOf({
        overview: [para('overview', 0, ' Overview. ')],
        findings: [para('findings', 0, 'A'), para('findings', 1, ''), para('findings', 2, 'B')],
      }),
    ).toEqual({ overview: 'Overview.', findings: 'A\n\nB', recommendations: '' });
  });
});

describe('approval', () => {
  const report = { status: 'draft' as const, author: { subject: 'brian', name: 'Brian Otieno' } };

  it('lets an EACC supervisor who is not the author approve', () => {
    expect(approvalOf(report, { subject: 'esther', roles: ['eacc-supervisor'] })).toBe(
      'can-approve',
    );
  });

  it('tells the author they cannot approve', () => {
    expect(approvalOf(report, { subject: 'brian', roles: ['eacc-supervisor'] })).toBe('author');
  });

  it('tells an analyst only an EACC supervisor can', () => {
    expect(approvalOf(report, { subject: 'baraka', roles: ['eacc-analyst'] })).toBe(
      'not-supervisor',
    );
  });

  it('has nothing to approve once approved', () => {
    expect(
      approvalOf(
        { ...report, status: 'approved' },
        { subject: 'esther', roles: ['eacc-supervisor'] },
      ),
    ).toBe('approved');
  });
});

describe('newReportsSince', () => {
  it('counts the reports received after a draft was built', () => {
    expect(
      newReportsSince({ reported: 12, report: { status: 'draft', reportsIncluded: 11 } }),
    ).toBe(1);
    expect(
      newReportsSince({ reported: 11, report: { status: 'draft', reportsIncluded: 11 } }),
    ).toBe(0);
  });

  it('counts none for an approved report, which no longer changes', () => {
    expect(
      newReportsSince({ reported: 12, report: { status: 'approved', reportsIncluded: 11 } }),
    ).toBe(0);
  });
});
