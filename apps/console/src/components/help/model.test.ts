import { describe, expect, it } from 'vitest';

import type {
  CorpusPassage,
  HelpArticle,
  QuestionThemeCount,
} from '../../server/declarations/client';
import {
  articleDraft,
  articleInputOf,
  articleStatus,
  filterArticles,
  filterCorpus,
  isSuperseded,
  monthSummary,
  previewBlocks,
  problemFieldErrors,
  statusCounts,
  themeMonths,
  validateArticle,
} from './model';
import { nth } from './test-router';

const TODAY = '2026-10-03';

const article = (patch: Partial<HelpArticle> = {}): HelpArticle => ({
  id: '0199c0de-a000-7000-8000-000000000001',
  tenant: 'psc',
  title: 'File numbers: where to find yours',
  bodyEn: 'Your personnel file number is on your payslip.',
  bodySw: null,
  tags: ['bio'],
  effectiveFrom: '2026-07-01',
  effectiveTo: null,
  published: true,
  version: 1,
  updatedAt: '2026-09-12T08:20:00.000Z',
  ...patch,
});

describe('article status', () => {
  it('reads draft, scheduled, published and expired against today in Nairobi', () => {
    expect(articleStatus(article({ published: false }), TODAY)).toBe('draft');
    expect(articleStatus(article({ effectiveFrom: '2026-11-01' }), TODAY)).toBe('scheduled');
    expect(articleStatus(article(), TODAY)).toBe('published');
    // effectiveTo is exclusive: an article ending today is no longer in force.
    expect(articleStatus(article({ effectiveTo: TODAY }), TODAY)).toBe('expired');
    expect(articleStatus(article({ effectiveTo: '2026-10-04' }), TODAY)).toBe('published');
  });

  it('counts each status and filters by status and by title or tag', () => {
    const rows = [
      article(),
      article({ id: 'b', title: 'Housing Scheme Fund loans', tags: ['mortgage'] }),
      article({ id: 'c', title: 'Acting appointments', published: false }),
    ];
    expect(statusCounts(rows, TODAY)).toEqual({
      all: 3,
      published: 2,
      scheduled: 0,
      draft: 1,
      expired: 0,
    });
    expect(filterArticles(rows, { status: 'draft' }, TODAY).map((each) => each.id)).toEqual(['c']);
    expect(filterArticles(rows, { q: 'MORTGAGE' }, TODAY).map((each) => each.id)).toEqual(['b']);
    expect(filterArticles(rows, { q: 'housing' }, TODAY).map((each) => each.id)).toEqual(['b']);
  });
});

describe('article editor', () => {
  it('starts a new article as an unpublished draft in force from today', () => {
    expect(articleDraft(null, TODAY)).toEqual({
      title: '',
      bodyEn: '',
      bodySw: '',
      tags: [],
      effectiveFrom: TODAY,
      effectiveTo: '',
      published: false,
    });
  });

  it('sends an empty Kiswahili body and end date as null, the text trimmed', () => {
    const draft = { ...articleDraft(article(), TODAY), title: '  File numbers  ', bodySw: '  ' };
    expect(articleInputOf(draft)).toEqual({
      title: 'File numbers',
      bodyEn: 'Your personnel file number is on your payslip.',
      bodySw: null,
      tags: ['bio'],
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      published: true,
    });
  });

  it('asks for a title, English text and a start date, and an end after the start', () => {
    const errors = validateArticle({
      ...articleDraft(null, TODAY),
      title: ' ',
      effectiveFrom: '2026-07-01',
      effectiveTo: '2026-01-01',
    });
    expect(errors).toEqual({
      title: 'Enter a title.',
      bodyEn: 'Write the English text.',
      effectiveTo: 'The end date must be after the start date.',
    });
    expect(validateArticle({ ...articleDraft(null, TODAY), effectiveFrom: '' })).toMatchObject({
      effectiveFrom: 'Enter the date the article takes effect.',
    });
    expect(validateArticle({ ...articleDraft(article(), TODAY), title: 'x'.repeat(201) })).toEqual({
      title: 'Title must be 200 characters or fewer.',
    });
  });

  it("maps the service's validation errors onto the editor's fields", () => {
    expect(
      problemFieldErrors({
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        errors: [
          { path: 'title', message: 'Too big' },
          { path: 'effectiveTo', message: 'must be after effectiveFrom' },
          { path: 'effectiveFrom', message: 'Invalid ISO date' },
          { path: 'tags.3', message: 'Invalid option' },
        ],
      }),
    ).toEqual({
      title: 'Adili did not accept this title. Check it and try again.',
      effectiveTo: 'The end date must be after the start date.',
      effectiveFrom: 'Adili did not accept this start date. Check it and try again.',
      tags: 'Adili did not accept these tags. Check them and try again.',
    });
  });

  it('previews paragraphs, lists of "- " lines and **bold**', () => {
    expect(previewBlocks('First line\nsecond **bold**\n\n- one\n- two\n\n')).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [{ text: 'First line', bold: false }],
          [
            { text: 'second ', bold: false },
            { text: 'bold', bold: true },
          ],
        ],
      },
      {
        kind: 'list',
        items: [[{ text: 'one', bold: false }], [{ text: 'two', bold: false }]],
      },
    ]);
    expect(previewBlocks('   ')).toEqual([]);
  });
});

describe('corpus', () => {
  const passage = (patch: Partial<CorpusPassage>): CorpusPassage => ({
    id: 'p',
    source: 'act',
    citation: 'Act s.31(4)',
    title: 'Meaning of material change',
    tags: ['statement'],
    effectiveFrom: '2026-03-02',
    effectiveTo: null,
    version: 'c3f91a2e',
    ...patch,
  });

  it('hides superseded wordings unless asked, and filters by source and text', () => {
    const rows = [
      passage({ id: 'old', effectiveFrom: '2025-10-15', effectiveTo: '2026-03-02' }),
      passage({ id: 'now' }),
      passage({ id: 'r21', source: 'regs', citation: 'Regs r.21', title: 'Material change' }),
    ];
    expect(isSuperseded(nth(rows, 0), TODAY)).toBe(true);
    expect(filterCorpus(rows, {}, TODAY).map((each) => each.id)).toEqual(['now', 'r21']);
    expect(filterCorpus(rows, { old: true }, TODAY).map((each) => each.id)).toEqual([
      'old',
      'now',
      'r21',
    ]);
    expect(filterCorpus(rows, { source: 'regs' }, TODAY).map((each) => each.id)).toEqual(['r21']);
    expect(filterCorpus(rows, { q: 's.31' }, TODAY).map((each) => each.id)).toEqual(['now']);
  });
});

describe('question themes', () => {
  const counts: QuestionThemeCount[] = [
    { month: '2026-09', theme: 'vehicles', count: 20, unanswered: 1 },
    { month: '2026-09', theme: 'land', count: 12, unanswered: 3 },
    { month: '2026-07', theme: 'land', count: 5, unanswered: 0 },
  ];

  it('offers this month and every month counted, newest first', () => {
    expect(themeMonths(counts, '2026-10')).toEqual(['2026-10', '2026-09', '2026-07']);
    expect(themeMonths([], '2026-10')).toEqual(['2026-10']);
  });

  it("sums a month's questions and unanswered ones and names the most unanswered theme", () => {
    expect(monthSummary(counts, '2026-09')).toEqual({
      rows: [counts[0], counts[1]],
      total: 32,
      unanswered: 4,
      mostUnanswered: counts[1],
    });
    expect(monthSummary(counts, '2026-08')).toEqual({
      rows: [],
      total: 0,
      unanswered: 0,
      mostUnanswered: null,
    });
  });
});
