/**
 * In-memory stand-in for the declarations service's help endpoints (declarations.yaml, tag
 * `help`), used when HELP_MOCK is set, so the console's help pages run without the service.
 * One store for every caller, read from the bearer token's roles and `tenant` claim as the
 * service reads them:
 *
 * - a Commission's articles and question themes: its commission admins (who also edit them) and
 *   reporting officers (403 on a write); anyone else 404;
 * - platform articles and the corpus: platform admins; anyone else 403;
 * - help search as declarants get it (`previewHelpSearch`): a Commission's staff for their own
 *   Commission, platform admins for the platform's articles; anyone else 404.
 *
 * Every Commission the mock sees starts with the prototype's articles (written for the Public
 * Service Commission) and four months of question counts ending this month. Search ranks as the
 * prototype does (title, then tags, then text) over the law and the articles published and in
 * force today, so an article published here is found at once.
 */
import createClient from 'openapi-fetch';
import { z } from 'zod';

import { formatCalendarDate } from '@adili/ui';

import { json, mockCallerOf, noContent, problem, readJson, unsignedMockToken } from '../mock-http';
import type { paths } from './api.gen';
import type {
  CorpusPassage,
  CorpusPassageText,
  HelpArticle,
  HelpArticleInput,
  HelpPassage,
  QuestionTheme,
  QuestionThemeCount,
} from './client';
import { COMMISSION_ARTICLES, CORPUS, PLATFORM_ARTICLES } from './help-fixtures';
import { HELP_TAGS, QUESTION_THEMES, questionMonth } from './help-tags';

const COMMISSION_ADMIN = 'commission-admin';
const REPORTING_OFFICER = 'reporting-officer';
const PLATFORM_ADMIN = 'platform-admin';

/** The corpus version deployed with the service: the one stored, so a re-import is a no-op. */
const CORPUS_VERSION = 'c3f91a2e';

const articles = new Map<string, HelpArticle>();
const seededTenants = new Set<string>();
const themeCounts = new Map<string, QuestionThemeCount[]>();
const idempotent = new Map<string, { body: string; articleId: string }>();
let platformSeeded = false;
let nextId = 1;

/** Back to the seed: for tests, and the dev server's first request. */
export function resetHelpMock() {
  articles.clear();
  seededTenants.clear();
  themeCounts.clear();
  idempotent.clear();
  platformSeeded = false;
  nextId = 1;
}

/** Replaces a Commission's question counts (the declarations service's themes job, in tests). */
export function recordMockQuestions(tenant: string, counts: QuestionThemeCount[]) {
  themeCounts.set(tenant, counts);
}

/** A declarations client answered by this mock, as `name` holding `roles` at `tenant`, for tests. */
export function mockHelpClient(caller: { name: string; roles: readonly string[]; tenant: string }) {
  const token = unsignedMockToken({
    subject: `user-${caller.name.toLowerCase().replace(/\W+/g, '-')}`,
    name: caller.name,
    roles: caller.roles,
    tenant: caller.tenant,
  });
  return createClient<paths>({
    baseUrl: 'http://declarations.test',
    headers: { authorization: `Bearer ${token}` },
    fetch: mockHelpFetch,
  });
}

function seedPlatform() {
  if (platformSeeded) return;
  platformSeeded = true;
  for (const each of PLATFORM_ARTICLES) articles.set(each.id, { ...each, tenant: null });
}

/** A Commission's seed articles get ids of their own, so two Commissions' never collide. */
function seedTenant(tenant: string) {
  if (seededTenants.has(tenant)) return;
  seededTenants.add(tenant);
  for (const each of COMMISSION_ARTICLES) {
    const id = tenant === 'psc' ? each.id : newId();
    articles.set(id, { ...each, id, tenant });
  }
  if (!themeCounts.has(tenant)) themeCounts.set(tenant, seedThemes(new Date()));
}

function newId(): string {
  const n = nextId++;
  return `0199c0de-f000-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

/** The prototype's monthly counts per theme, for the last three months and this one to date. */
const SEED_COUNTS: [QuestionTheme, number, number][] = [
  ['household-spouses', 412, 31],
  ['children', 188, 9],
  ['land', 355, 44],
  ['vehicles', 214, 12],
  ['bank-accounts', 173, 8],
  ['shares-businesses', 149, 17],
  ['income', 301, 21],
  ['loans', 266, 19],
  ['material-changes', 238, 36],
  ['dates-obligations', 197, 6],
  ['assets-abroad', 88, 22],
  ['joint-ownership', 121, 14],
  ['registrable-interests', 64, 11],
  ['using-adili', 143, 4],
  ['other', 52, 18],
];

function seedThemes(now: Date): QuestionThemeCount[] {
  const today = formatCalendarDate(now.getTime());
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const monthKey = (back: number) => {
    const index = year * 12 + (month - 1) - back;
    return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`;
  };
  return [0.24, 1, 0.78, 0.41].flatMap((factor, back) =>
    SEED_COUNTS.map(([theme, count, unanswered]) => ({
      month: monthKey(back),
      theme,
      count: Math.max(1, Math.round(count * factor)),
      unanswered: Math.round(unanswered * factor),
    })),
  );
}

interface Caller {
  roles: string[];
  tenant: string | null;
}

const isHelpStaff = (caller: Caller, slug: string) =>
  caller.tenant === slug &&
  (caller.roles.includes(COMMISSION_ADMIN) || caller.roles.includes(REPORTING_OFFICER));

const notFound = () => problem(404, 'Not found');
const forbidden = (title: string) => problem(403, title);

const isoDate = z.iso.date();

/** The service's `HelpArticleInput` rules (help/representation.ts). */
const articleInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    bodyEn: z.string().trim().min(1).max(20_000),
    bodySw: z.string().trim().min(1).max(20_000).nullable(),
    tags: z.array(z.enum(HELP_TAGS)).max(20),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable(),
    published: z.boolean(),
  })
  .refine(({ effectiveFrom, effectiveTo }) => effectiveTo === null || effectiveTo > effectiveFrom, {
    path: ['effectiveTo'],
    message: 'must be after effectiveFrom',
  });

function parseInput(body: unknown): HelpArticleInput | Response {
  const parsed = articleInput.safeParse(body);
  if (parsed.success) return parsed.data;
  return json(400, {
    type: 'about:blank',
    title: 'Validation failed',
    status: 400,
    errors: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

const byUpdated = (a: HelpArticle, b: HelpArticle) =>
  b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);

function list(tenant: string | null): Response {
  return json(200, [...articles.values()].filter((each) => each.tenant === tenant).sort(byUpdated));
}

async function create(request: Request, tenant: string | null): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'Idempotency-Key header missing');
  const body = await readJson(request);
  const input = parseInput(body);
  if (input instanceof Response) return input;
  const scopedKey = `${tenant ?? ''}|${key}`;
  const seen = idempotent.get(scopedKey);
  const bodyText = JSON.stringify(body);
  if (seen) {
    if (seen.body !== bodyText) return problem(422, 'Idempotency-Key reused with another request');
    const stored = articles.get(seen.articleId);
    if (stored) return json(201, stored);
  }
  const article: HelpArticle = {
    id: newId(),
    tenant,
    ...input,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  articles.set(article.id, article);
  idempotent.set(scopedKey, { body: bodyText, articleId: article.id });
  return json(201, article);
}

async function update(request: Request, tenant: string | null, id: string): Promise<Response> {
  const current = articles.get(id);
  if (current?.tenant !== tenant) return notFound();
  const input = parseInput(await readJson(request));
  if (input instanceof Response) return input;
  const updated: HelpArticle = {
    ...current,
    ...input,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  };
  articles.set(id, updated);
  return json(200, updated);
}

function remove(tenant: string | null, id: string): Response {
  const current = articles.get(id);
  if (current?.tenant !== tenant) return notFound();
  articles.delete(id);
  return noContent();
}

const inForce = (from: string, to: string | null, day: string) =>
  from <= day && (to === null || day < to);

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);

/** The text around the first matched word, at most 200 characters. */
function snippetOf(text: string, query: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.min(
    ...query.map((word) => lower.indexOf(word)).filter((index) => index >= 0),
    text.length,
  );
  // From a word's start, about 60 characters before the match.
  const start = at === text.length || at < 60 ? 0 : text.indexOf(' ', at - 60) + 1;
  const slice = text.slice(start, start + 200);
  return `${start > 0 ? '…' : ''}${slice}${start + 200 < text.length ? '…' : ''}`;
}

interface Candidate {
  passage: Omit<HelpPassage, 'snippet' | 'language'>;
  title: string;
  tags: readonly string[];
  en: string;
  sw: string | null;
}

function search(url: URL, caller: Caller): Response {
  const q = url.searchParams.get('q') ?? '';
  const language = url.searchParams.get('language');
  const commission = url.searchParams.get('commission');
  if (q.trim().length < 2 || q.length > 200 || (language !== 'en' && language !== 'sw')) {
    return problem(400, 'Query failed validation');
  }
  // Platform admins search as every declarant (no Commission); a Commission's staff as its own.
  if (
    commission === null ? !caller.roles.includes(PLATFORM_ADMIN) : !isHelpStaff(caller, commission)
  ) {
    return notFound();
  }
  if (commission) seedTenant(commission);
  const day = url.searchParams.get('date') ?? formatCalendarDate(Date.now());
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') ?? 8) || 8));
  const query = words(q);
  const candidates: Candidate[] = [
    ...CORPUS.filter((each) => inForce(each.effectiveFrom, each.effectiveTo, day)).map((each) => ({
      passage: { id: each.id, source: each.source, citation: each.citation, title: each.title },
      title: each.title,
      tags: each.tags,
      en: each.textEn,
      sw: each.textSw,
    })),
    ...[...articles.values()]
      .filter(
        (each) =>
          each.published &&
          (each.tenant === null || each.tenant === commission) &&
          inForce(each.effectiveFrom, each.effectiveTo, day),
      )
      .map((each) => ({
        passage: {
          id: each.id,
          source: 'help' as const,
          citation: `Help: ${each.title}`,
          title: each.title,
        },
        title: each.title,
        tags: each.tags,
        en: each.bodyEn,
        sw: each.bodySw,
      })),
  ];
  const ranked = candidates
    .map((candidate) => {
      const swText = language === 'sw' ? candidate.sw : null;
      const text = swText ?? candidate.en;
      const title = candidate.title.toLowerCase();
      const tags = candidate.tags.join(' ');
      const lower = text.toLowerCase();
      const score = query.reduce(
        (sum, word) =>
          sum +
          (title.includes(word) ? 3 : 0) +
          (tags.includes(word) ? 2 : 0) +
          (lower.includes(word) ? 1 : 0),
        0,
      );
      return {
        score,
        passage: {
          ...candidate.passage,
          snippet: snippetOf(text, query),
          language: swText === null ? ('en' as const) : ('sw' as const),
        },
      };
    })
    .filter((each) => each.score > 0)
    .sort((a, b) => b.score - a.score);
  return json(
    200,
    ranked.slice(0, limit).map((each) => each.passage),
  );
}

const withoutText = (passage: CorpusPassageText): CorpusPassage => ({
  id: passage.id,
  source: passage.source,
  citation: passage.citation,
  title: passage.title,
  tags: passage.tags,
  effectiveFrom: passage.effectiveFrom,
  effectiveTo: passage.effectiveTo,
  version: passage.version,
});

function themes(url: URL, tenant: string): Response {
  const month = url.searchParams.get('month');
  if (month !== null && !questionMonth.safeParse(month).success) {
    return problem(400, 'Query failed validation');
  }
  const counts = (themeCounts.get(tenant) ?? [])
    .filter((each) => month === null || each.month === month)
    .sort(
      (a, b) =>
        b.month.localeCompare(a.month) ||
        b.count - a.count ||
        QUESTION_THEMES.indexOf(a.theme) - QUESTION_THEMES.indexOf(b.theme),
    );
  return json(200, counts);
}

/** Answers the help endpoints of declarations.yaml as the service would. */
export async function mockHelpFetch(request: Request): Promise<Response> {
  seedPlatform();
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;
  const caller = mockCallerOf(request);

  if (method === 'GET' && pathname === '/v1/help/search/preview') return search(url, caller);

  const commission =
    /^\/v1\/commissions\/([a-z][a-z0-9]{1,19})\/help\/(articles|themes)(?:\/([^/]+))?$/.exec(
      pathname,
    );
  if (commission) {
    const [, slug = '', resource, articleId] = commission;
    if (!isHelpStaff(caller, slug)) return notFound();
    seedTenant(slug);
    if (resource === 'themes') {
      return method === 'GET' && !articleId ? themes(url, slug) : notFound();
    }
    if (method === 'GET' && !articleId) return list(slug);
    if (!caller.roles.includes(COMMISSION_ADMIN)) {
      return forbidden("Only the Commission's administrators edit its help articles.");
    }
    if (method === 'POST' && !articleId) return create(request, slug);
    if (method === 'PUT' && articleId) return update(request, slug, articleId);
    if (method === 'DELETE' && articleId) return remove(slug, articleId);
    return notFound();
  }

  if (pathname.startsWith('/v1/help/')) {
    if (!caller.roles.includes(PLATFORM_ADMIN)) return forbidden('Not a platform admin');
    if (method === 'GET' && pathname === '/v1/help/articles') return list(null);
    if (method === 'POST' && pathname === '/v1/help/articles') return create(request, null);
    const platformArticle = /^\/v1\/help\/articles\/([^/]+)$/.exec(pathname)?.[1];
    if (platformArticle && method === 'PUT') return update(request, null, platformArticle);
    if (platformArticle && method === 'DELETE') return remove(null, platformArticle);
    if (method === 'GET' && pathname === '/v1/help/corpus') {
      return json(
        200,
        [...CORPUS]
          .sort(
            (a, b) =>
              a.source.localeCompare(b.source) ||
              a.citation.localeCompare(b.citation) ||
              a.effectiveFrom.localeCompare(b.effectiveFrom),
          )
          .map(withoutText),
      );
    }
    if (method === 'POST' && pathname === '/v1/help/corpus/import') {
      return json(200, {
        version: CORPUS_VERSION,
        skipped: true,
        inserted: 0,
        updated: 0,
        removed: 0,
        unchanged: CORPUS.filter((each) => each.version === CORPUS_VERSION).length,
      });
    }
    const passageId = /^\/v1\/help\/corpus\/([^/]+)$/.exec(pathname)?.[1];
    if (passageId && method === 'GET') {
      const passage = CORPUS.find((each) => each.id === passageId);
      return passage ? json(200, passage) : notFound();
    }
  }
  return problem(404, 'Not mocked');
}
