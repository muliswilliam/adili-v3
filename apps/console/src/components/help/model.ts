import { z } from 'zod';

import type {
  CorpusPassage,
  HelpArticle,
  HelpArticleInput,
  HelpTag,
  QuestionThemeCount,
} from '../../server/declarations/client';
import type { HelpProblem } from '../../server/help.server';
import { messages as m } from './messages';

/**
 * The help pages' rules (spec 11 FE-4): an article's status on a day, the list's filters, the
 * editor's draft and its checks, the corpus filters and a month of question themes. Dates are
 * calendar days in Nairobi (`YYYY-MM-DD`); effective-to dates are exclusive, as the service has
 * them.
 */

export const ARTICLE_STATUSES = ['published', 'scheduled', 'draft', 'expired'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

/** Where an article stands on `today`: not published, not yet in force, in force, or ended. */
export function articleStatus(
  article: Pick<HelpArticle, 'published' | 'effectiveFrom' | 'effectiveTo'>,
  today: string,
): ArticleStatus {
  if (!article.published) return 'draft';
  if (article.effectiveTo !== null && article.effectiveTo <= today) return 'expired';
  if (article.effectiveFrom > today) return 'scheduled';
  return 'published';
}

/** The articles list's URL state: search text, status filter and page. */
export const articlesSearch = z.object({
  q: z.string().max(100).optional().catch(undefined),
  status: z.enum(ARTICLE_STATUSES).optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
});

export type ArticlesSearch = z.infer<typeof articlesSearch>;

export const ARTICLES_PAGE_SIZE = 10;

export function statusCounts(
  articles: readonly HelpArticle[],
  today: string,
): Record<ArticleStatus | 'all', number> {
  const counts = { all: articles.length, published: 0, scheduled: 0, draft: 0, expired: 0 };
  for (const article of articles) counts[articleStatus(article, today)] += 1;
  return counts;
}

/** Articles whose title or a tag's name contains the search text, in the status asked for. */
export function filterArticles(
  articles: readonly HelpArticle[],
  { q, status }: Pick<ArticlesSearch, 'q' | 'status'>,
  today: string,
): HelpArticle[] {
  const text = (q ?? '').trim().toLowerCase();
  return articles.filter(
    (article) =>
      (!status || articleStatus(article, today) === status) &&
      (!text ||
        article.title.toLowerCase().includes(text) ||
        article.tags.some((tag) => m.tag[tag].toLowerCase().includes(text) || tag.includes(text))),
  );
}

/** The editor's form: text fields as typed, empty strings for no Kiswahili and no end date. */
export interface ArticleDraft {
  title: string;
  bodyEn: string;
  bodySw: string;
  tags: HelpTag[];
  effectiveFrom: string;
  effectiveTo: string;
  published: boolean;
}

export function articleDraft(article: HelpArticle | null, today: string): ArticleDraft {
  if (!article) {
    return {
      title: '',
      bodyEn: '',
      bodySw: '',
      tags: [],
      effectiveFrom: today,
      effectiveTo: '',
      published: false,
    };
  }
  return {
    title: article.title,
    bodyEn: article.bodyEn,
    bodySw: article.bodySw ?? '',
    tags: [...article.tags],
    effectiveFrom: article.effectiveFrom,
    effectiveTo: article.effectiveTo ?? '',
    published: article.published,
  };
}

/** What the service is sent: text trimmed, no Kiswahili and no end date as null. */
export function articleInputOf(draft: ArticleDraft): HelpArticleInput {
  const bodySw = draft.bodySw.trim();
  return {
    title: draft.title.trim(),
    bodyEn: draft.bodyEn.trim(),
    bodySw: bodySw ? bodySw : null,
    tags: draft.tags,
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo ? draft.effectiveTo : null,
    published: draft.published,
  };
}

export const ARTICLE_FIELDS = [
  'title',
  'bodyEn',
  'bodySw',
  'tags',
  'effectiveFrom',
  'effectiveTo',
] as const;
export type ArticleField = (typeof ARTICLE_FIELDS)[number];
export type ArticleErrors = Partial<Record<ArticleField, string>>;

export const TITLE_MAX = 200;
export const BODY_MAX = 20_000;

/**
 * The editor's own checks, the service's rules in the prototype's words. `invalidDates` names
 * the date fields whose text is not a real date (the date is then empty in the draft).
 */
export function validateArticle(
  draft: ArticleDraft,
  invalidDates: readonly ('effectiveFrom' | 'effectiveTo')[] = [],
): ArticleErrors {
  const errors: ArticleErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = m.errorTitleMissing;
  else if (title.length > TITLE_MAX) errors.title = m.errorTitleLong;
  if (!draft.bodyEn.trim()) errors.bodyEn = m.errorBodyEnMissing;
  else if (draft.bodyEn.trim().length > BODY_MAX) errors.bodyEn = m.errorBodyLong;
  if (draft.bodySw.trim().length > BODY_MAX) errors.bodySw = m.errorBodyLong;
  if (invalidDates.includes('effectiveFrom')) errors.effectiveFrom = m.errorDateInvalid;
  else if (!draft.effectiveFrom) errors.effectiveFrom = m.errorFromMissing;
  if (invalidDates.includes('effectiveTo')) errors.effectiveTo = m.errorDateInvalid;
  else if (draft.effectiveTo && draft.effectiveFrom && draft.effectiveTo <= draft.effectiveFrom) {
    errors.effectiveTo = m.errorToBeforeFrom;
  }
  return errors;
}

/** The service's 400 field errors on the editor's fields; an unknown path is not shown on one. */
export function problemFieldErrors(problem: HelpProblem): ArticleErrors {
  const errors: ArticleErrors = {};
  for (const { path, message } of problem.errors ?? []) {
    const field = ARTICLE_FIELDS.find((each) => path === each || path.startsWith(`${each}.`));
    if (!field || errors[field]) continue;
    errors[field] = field === 'effectiveTo' ? m.errorToBeforeFrom : m.refused(field, message);
  }
  return errors;
}

/** A run of text in the preview, bold or not. */
export interface PreviewRun {
  text: string;
  bold: boolean;
}

export type PreviewBlock =
  { kind: 'paragraph'; lines: PreviewRun[][] } | { kind: 'list'; items: PreviewRun[][] };

function runs(line: string): PreviewRun[] {
  return line
    .split(/\*\*(.+?)\*\*/g)
    .map((text, index) => ({ text, bold: index % 2 === 1 }))
    .filter((run) => run.text !== '');
}

/**
 * The body as declarants read it: blank lines separate paragraphs, a paragraph of `- ` lines is
 * a list, `**text**` is bold. Nothing else is markup.
 */
export function previewBlocks(body: string): PreviewBlock[] {
  return body
    .trim()
    .split(/\n\s*\n/)
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((line) => /^\s*-\s+/.test(line))) {
        return { kind: 'list', items: lines.map((line) => runs(line.replace(/^\s*-\s+/, ''))) };
      }
      return { kind: 'paragraph', lines: lines.map(runs) };
    });
}

/** A wording no longer in force on `today` (its end date is exclusive). */
export function isSuperseded(passage: Pick<CorpusPassage, 'effectiveTo'>, today: string): boolean {
  return passage.effectiveTo !== null && passage.effectiveTo <= today;
}

/** The version most of `passages` were written by: the corpus version in force. */
export function corpusVersion(passages: readonly Pick<CorpusPassage, 'version'>[]): string | null {
  const counts = new Map<string, number>();
  for (const { version } of passages) counts.set(version, (counts.get(version) ?? 0) + 1);
  let best: string | null = null;
  for (const [version, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = version;
  }
  return best;
}

export const CORPUS_SOURCES = ['act', 'regs', 'am'] as const;

/** The corpus page's URL state. */
export const corpusSearch = z.object({
  q: z.string().max(100).optional().catch(undefined),
  source: z.enum(CORPUS_SOURCES).optional().catch(undefined),
  old: z.boolean().optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
});

export type CorpusSearch = z.infer<typeof corpusSearch>;

export const CORPUS_PAGE_SIZE = 10;

/** Wordings in force (or every one with `old`), from a source, whose citation or title matches. */
export function filterCorpus(
  passages: readonly CorpusPassage[],
  { q, source, old }: Pick<CorpusSearch, 'q' | 'source' | 'old'>,
  today: string,
): CorpusPassage[] {
  const text = (q ?? '').trim().toLowerCase();
  return passages.filter(
    (passage) =>
      (old === true || !isSuperseded(passage, today)) &&
      (!source || passage.source === source) &&
      (!text || `${passage.citation} ${passage.title}`.toLowerCase().includes(text)),
  );
}

/** The themes page's URL state: one month (`YYYY-MM`), this one by default. */
export const themesSearch = z.object({
  month: z
    .string()
    .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
});

export type ThemesSearch = z.infer<typeof themesSearch>;

/** The months to offer: this one (counting to date) and every month with counts, newest first. */
export function themeMonths(counts: readonly QuestionThemeCount[], thisMonth: string): string[] {
  return [...new Set([thisMonth, ...counts.map((each) => each.month)])].sort().reverse();
}

export interface MonthSummary {
  /** The month's themes, most asked first (as the service orders them). */
  rows: QuestionThemeCount[];
  total: number;
  unanswered: number;
  /** The theme with the most unanswered questions; null when none went unanswered. */
  mostUnanswered: QuestionThemeCount | null;
}

export function monthSummary(counts: readonly QuestionThemeCount[], month: string): MonthSummary {
  const rows = counts.filter((each) => each.month === month);
  let mostUnanswered: QuestionThemeCount | null = null;
  for (const row of rows) {
    if (row.unanswered > 0 && (!mostUnanswered || row.unanswered > mostUnanswered.unanswered)) {
      mostUnanswered = row;
    }
  }
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.count, 0),
    unanswered: rows.reduce((sum, row) => sum + row.unanswered, 0),
    mostUnanswered,
  };
}

/** A whole percentage of `part` in `total`; 0 of nothing. */
export function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}
