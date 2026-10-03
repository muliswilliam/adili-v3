import { describe, expect, it } from 'vitest';

import type { NarrativeParagraph } from '../../server/reporting/types';
import {
  appendParagraph,
  approvalOf,
  editorValueOf,
  narrativeTextOf,
  ncrSearchSchema,
  newReportsSince,
} from './model';

describe('page address', () => {
  it('reads the year and page, dropping what is not a year reports exist for', () => {
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

describe('appendParagraph', () => {
  it('adds a paragraph at the end of a section, dropping its empty fields', () => {
    const value = appendParagraph(
      { findings: [para('findings', 0, 'A'), para('findings', 1, ' ')] },
      'findings',
      { text: 'Cited.', aggregateRefs: ['national.rate.all'] },
    );

    expect(
      value.findings?.map(({ text, position, aiDraft, aggregateRefs }) => ({
        text,
        position,
        aiDraft,
        aggregateRefs,
      })),
    ).toEqual([
      { text: 'A', position: 0, aiDraft: false, aggregateRefs: [] },
      { text: 'Cited.', position: 1, aiDraft: false, aggregateRefs: ['national.rate.all'] },
    ]);
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
