import { beforeEach, describe, expect, it } from 'vitest';

import {
  mockHelpClient,
  recordMockQuestions,
  resetHelpMock,
} from './declarations/help-mock.server';
import type { HelpArticleInput } from './declarations/client';
import {
  importStatutoryCorpus,
  loadCorpus,
  loadCorpusPassage,
  loadHelpArticles,
  loadQuestionThemes,
  saveHelpArticle,
  searchAsDeclarants,
} from './help.server';

const PSC = { kind: 'commission', slug: 'psc' } as const;
const PLATFORM = { kind: 'platform' } as const;

const admin = () =>
  mockHelpClient({ name: 'Daniel Kiprop', roles: ['commission-admin'], tenant: 'psc' });
const officer = () =>
  mockHelpClient({ name: 'Grace Muthoni', roles: ['reporting-officer'], tenant: 'psc' });
const platformAdmin = () =>
  mockHelpClient({ name: 'Amina Wanjiru', roles: ['platform-admin'], tenant: 'platform' });
const reviewer = () => mockHelpClient({ name: 'Rose Achieng', roles: ['reviewer'], tenant: 'psc' });

const article = (patch: Partial<HelpArticleInput> = {}): HelpArticleInput => ({
  title: 'Acting appointments and confirmation',
  bodyEn: 'An acting appointment does not create a new filing obligation.',
  bodySw: null,
  tags: ['employment'],
  effectiveFrom: '2026-07-01',
  effectiveTo: null,
  published: true,
  ...patch,
});

const KEY = '0199c0de-0000-7000-8000-00000000abcd';

beforeEach(() => {
  resetHelpMock();
});

describe('Commission help articles (S9)', () => {
  it("lists the Commission's articles, published or not, last updated first", async () => {
    const result = await loadHelpArticles(admin(), PSC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(22);
    expect(result.data.every((each) => each.tenant === 'psc')).toBe(true);
    expect(result.data.some((each) => !each.published)).toBe(true);
    const times = result.data.map((each) => each.updatedAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("lets the Commission's reporting officers read them", async () => {
    const result = await loadHelpArticles(officer(), PSC);
    expect(result.ok).toBe(true);
  });

  it('hides them from staff of the Commission without a help role, and from another Commission', async () => {
    const asReviewer = await loadHelpArticles(reviewer(), PSC);
    expect(asReviewer).toMatchObject({ ok: false, error: { problem: { status: 404 } } });
    const otherCommission = await loadHelpArticles(admin(), { kind: 'commission', slug: 'tsc' });
    expect(otherCommission).toMatchObject({ ok: false, error: { problem: { status: 404 } } });
  });

  it("publishes a new article that the Commission's declarants find in help search at once", async () => {
    const before = await searchAsDeclarants(admin(), PSC, {
      q: 'acting appointment',
      language: 'en',
    });
    expect(
      before.ok && before.data.some((each) => each.title.startsWith('Acting appointments and')),
    ).toBe(false);

    const saved = await saveHelpArticle(admin(), PSC, {
      articleId: null,
      idempotencyKey: KEY,
      input: article(),
    });
    expect(saved).toMatchObject({ ok: true, data: { tenant: 'psc', version: 1, published: true } });

    const found = await searchAsDeclarants(admin(), PSC, {
      q: 'acting appointment',
      language: 'en',
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.data[0]).toMatchObject({
      source: 'help',
      citation: 'Help: Acting appointments and confirmation',
    });
    // Another Commission's declarants do not get it.
    const tsc = mockHelpClient({ name: 'Jane', roles: ['commission-admin'], tenant: 'tsc' });
    const elsewhere = await searchAsDeclarants(
      tsc,
      { kind: 'commission', slug: 'tsc' },
      {
        q: 'acting appointment confirmation',
        language: 'en',
      },
    );
    expect(
      elsewhere.ok &&
        elsewhere.data.some(
          (each) => each.source === 'help' && each.title.startsWith('Acting appointments and'),
        ),
    ).toBe(false);
  });

  it('retries a create with the same Idempotency-Key as the same article', async () => {
    const first = await saveHelpArticle(admin(), PSC, {
      articleId: null,
      idempotencyKey: KEY,
      input: article(),
    });
    const again = await saveHelpArticle(admin(), PSC, {
      articleId: null,
      idempotencyKey: KEY,
      input: article(),
    });
    expect(first.ok && again.ok && first.data.id === again.data.id).toBe(true);
    const list = await loadHelpArticles(admin(), PSC);
    expect(list.ok && list.data.length).toBe(23);
  });

  it('counts saves in the version and keeps drafts out of help search', async () => {
    const created = await saveHelpArticle(admin(), PSC, {
      articleId: null,
      idempotencyKey: KEY,
      input: article({ published: false }),
    });
    if (!created.ok) throw new Error('not created');
    const hidden = await searchAsDeclarants(admin(), PSC, {
      q: 'acting appointment confirmation',
      language: 'en',
    });
    expect(hidden.ok && hidden.data.some((each) => each.id === created.data.id)).toBe(false);

    const updated = await saveHelpArticle(admin(), PSC, {
      articleId: created.data.id,
      idempotencyKey: KEY,
      input: article({ published: true, bodySw: 'Uteuzi wa kukaimu haujengi wajibu mpya.' }),
    });
    expect(updated).toMatchObject({ ok: true, data: { version: 2, published: true } });
    const sw = await searchAsDeclarants(admin(), PSC, { q: 'uteuzi kukaimu', language: 'sw' });
    expect(sw.ok && sw.data[0]).toMatchObject({ id: created.data.id, language: 'sw' });
  });

  it('refuses a reporting officer with 403', async () => {
    const result = await saveHelpArticle(officer(), PSC, {
      articleId: null,
      idempotencyKey: KEY,
      input: article(),
    });
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 403 } } });
  });

  it('answers 400 with the fields that failed validation', async () => {
    const result = await saveHelpArticle(admin(), PSC, {
      articleId: null,
      idempotencyKey: KEY,
      input: article({ title: ' ', effectiveTo: '2026-01-01' }),
    });
    expect(result).toMatchObject({ ok: false, error: { problem: { status: 400 } } });
    if (result.ok || result.error.kind !== 'problem') return;
    expect(result.error.problem.errors?.map((each) => each.path).sort()).toEqual([
      'effectiveTo',
      'title',
    ]);
  });

  it('keeps an article not in force out of help search', async () => {
    await saveHelpArticle(admin(), PSC, {
      articleId: null,
      idempotencyKey: KEY,
      input: article({ effectiveFrom: '2099-01-01' }),
    });
    const result = await searchAsDeclarants(admin(), PSC, {
      q: 'acting appointment confirmation',
      language: 'en',
    });
    expect(
      result.ok && result.data.some((each) => each.title.startsWith('Acting appointments and')),
    ).toBe(false);
  });
});

describe('platform help articles and the corpus (S9)', () => {
  it('lists and saves platform articles for platform admins only', async () => {
    const list = await loadHelpArticles(platformAdmin(), PLATFORM);
    expect(list.ok && list.data.length).toBe(12);
    expect(list.ok && list.data.every((each) => each.tenant === null)).toBe(true);
    const refused = await loadHelpArticles(admin(), PLATFORM);
    expect(refused).toMatchObject({ ok: false, error: { problem: { status: 403 } } });

    const saved = await saveHelpArticle(platformAdmin(), PLATFORM, {
      articleId: null,
      idempotencyKey: KEY,
      input: article({ title: 'Acting appointments and confirmation' }),
    });
    expect(saved).toMatchObject({ ok: true, data: { tenant: null } });
    // Every Commission's declarants find a platform article.
    const psc = await searchAsDeclarants(admin(), PSC, {
      q: 'acting appointment confirmation',
      language: 'en',
    });
    expect(psc.ok && psc.data.some((each) => saved.ok && each.id === saved.data.id)).toBe(true);
  });

  it('searches as every declarant would for a platform admin: the law and platform articles', async () => {
    const result = await searchAsDeclarants(platformAdmin(), PLATFORM, {
      q: 'file number payslip',
      language: 'en',
    });
    expect(result.ok).toBe(true);
    // The Commission's own article on file numbers is not the platform's.
    expect(result.ok && result.data.some((each) => each.title.startsWith('File numbers'))).toBe(
      false,
    );
  });

  it('lists the corpus with superseded wordings, and opens one with its text', async () => {
    const corpus = await loadCorpus(platformAdmin());
    expect(corpus.ok).toBe(true);
    if (!corpus.ok) return;
    const wordings = corpus.data.filter((each) => each.citation === 'Act s.31(4)');
    expect(wordings.map((each) => each.effectiveTo)).toEqual(['2026-03-02', null]);
    const current = wordings[1];
    if (!current) throw new Error('no current wording');
    const passage = await loadCorpusPassage(platformAdmin(), current.id);
    expect(passage).toMatchObject({ ok: true, data: { citation: 'Act s.31(4)' } });
    expect(passage.ok && passage.data.textSw).toMatch(/mabadiliko makubwa/);
    expect(await loadCorpus(admin())).toMatchObject({
      ok: false,
      error: { problem: { status: 403 } },
    });
  });

  it('re-imports the deployed corpus as a no-op when it is the version stored', async () => {
    const result = await importStatutoryCorpus(platformAdmin());
    expect(result).toMatchObject({ ok: true, data: { skipped: true, inserted: 0, updated: 0 } });
  });
});

describe('question themes (S8)', () => {
  it("reads the Commission's monthly counts, newest month first, then the most asked", async () => {
    recordMockQuestions('psc', [
      { month: '2026-09', theme: 'land', count: 12, unanswered: 3 },
      { month: '2026-09', theme: 'vehicles', count: 20, unanswered: 1 },
      { month: '2026-08', theme: 'land', count: 5, unanswered: 0 },
    ]);
    const result = await loadQuestionThemes(officer(), 'psc');
    expect(result).toEqual({
      ok: true,
      data: [
        { month: '2026-09', theme: 'vehicles', count: 20, unanswered: 1 },
        { month: '2026-09', theme: 'land', count: 12, unanswered: 3 },
        { month: '2026-08', theme: 'land', count: 5, unanswered: 0 },
      ],
    });
    expect(await loadQuestionThemes(platformAdmin(), 'psc')).toMatchObject({
      ok: false,
      error: { problem: { status: 404 } },
    });
  });
});
