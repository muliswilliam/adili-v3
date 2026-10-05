import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  commissionRefs,
  corpusPassages,
  filingObligations,
  outbox,
  rosterSnapshots,
} from '../../src/db/schema.js';
import { type CorpusFile, corpusVersion, loadCorpus } from '../../src/help/corpus.js';
import type {
  CorpusImportResult,
  CorpusPassageView,
  HelpArticle,
  HelpArticleInput,
  HelpPassage,
  HelpPassageDetail,
} from '../../src/help/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import {
  type Caller,
  type DeclarationsApi,
  startDeclarationsApi,
} from '../support/declarations-api.js';

/**
 * Spec 11 S6, S9 and S10 over HTTP, against the committed corpus as the service imports it on
 * boot: retrieval golden queries in English and Swahili, the effective-date filter, Commission
 * articles for their own declarants only, article authoring and publishing, the platform-admin
 * corpus import, and who may do what.
 */

const ACHIENG = randomUUID();
const BARAKA = randomUUID();
/** A PSC declarant, a TSC declarant. */
const pscDeclarant: Caller = { personId: ACHIENG, roles: ['declarant'] };
const tscDeclarant: Caller = { personId: BARAKA, roles: ['declarant'] };
const pscAdmin: Caller = { tenant: 'psc', roles: ['commission-admin'] };
const pscOfficer: Caller = { tenant: 'psc', roles: ['reporting-officer'] };
const pscReviewer: Caller = { tenant: 'psc', roles: ['reviewer'] };
const tscAdmin: Caller = { tenant: 'tsc', roles: ['commission-admin'] };
const platformAdmin: Caller = { tenant: 'platform', roles: ['platform-admin'] };

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
});

/** A new Idempotency-Key header, which every article create needs. */
const freshKey = () => ({ 'idempotency-key': randomUUID() });

beforeEach(async () => {
  await api.reset();
  await givenObligation(ACHIENG, 'psc');
  await givenObligation(BARAKA, 'tsc');
});

/** An onboarded declarant's roster record and biennial obligation with Commission `tenant`. */
async function givenObligation(personId: string, tenant: string): Promise<void> {
  const rosterRecordId = randomUUID();
  await api.asPlatform(async (tx) => {
    await tx.insert(rosterSnapshots).values({
      rosterRecordId,
      tenant,
      personnelFileNumber: `${tenant.toUpperCase()}/0001`,
      fullName: 'Test Declarant',
      state: 'onboarded',
      appointmentDate: '2015-01-05',
      personId,
      sourceUpdatedAt: new Date(),
    });
    await tx.insert(filingObligations).values({
      id: randomUUID(),
      tenant,
      rosterRecordId,
      personId,
      type: 'biennial',
      cycleKey: 'biennial:2027',
      statementDate: '2027-11-01',
      dueDate: '2027-12-31',
      status: 'due',
      policyVersionId: randomUUID(),
      policyVersion: 1,
      reminderOffsetsDays: [30, 14, 7],
    });
  });
}

interface SearchOptions {
  language?: 'en' | 'sw';
  sectionKey?: string;
  itemType?: string;
  date?: string;
}

async function search(
  q: string,
  { language = 'en', ...rest }: SearchOptions = {},
  caller: Caller = pscDeclarant,
) {
  const params = new URLSearchParams({ q, language });
  for (const [name, value] of Object.entries(rest)) if (value) params.set(name, value);
  return api.get(`/v1/help/search?${params.toString()}`, caller);
}

async function citations(q: string, options: SearchOptions = {}, caller?: Caller) {
  const response = await search(q, options, caller);
  expect(response.statusCode).toBe(200);
  return response.json<HelpPassage[]>().map((passage) => passage.citation);
}

function article(overrides: Partial<HelpArticleInput> = {}): HelpArticleInput {
  return {
    title: 'Personnel file numbers',
    bodyEn:
      'Your personnel file number is on your payslip. Human resources issues it when you join.',
    bodySw: null,
    tags: ['bio'],
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    published: true,
    ...overrides,
  };
}

const articles = (slug: string) => `/v1/commissions/${slug}/help/articles`;

describe('S6 retrieval golden queries', () => {
  // The demo's matatu question on the officer's statement, at a vehicle: the First Schedule's
  // financial statement (assets "including vehicles"), with note 13 (joint assets) close behind.
  const matatu = 'Is a matatu I co-own with my brother an asset?';
  const vehicleItem = { sectionKey: 'statement:officer', itemType: 'vehicle' };

  it.each([
    [matatu, vehicleItem, 'Act First Schedule, para. 8'],
    [matatu, {}, 'Act First Schedule, note 13'],
    ["Do I declare my wife's salary?", {}, 'Act First Schedule, para. 8'],
    ['What counts as a material change?', {}, 'Regs r.21'],
    ['When is the biennial declaration due?', {}, 'Act First Schedule, note 7'],
    ['What happens if I give false information?', {}, 'Act s.39'],
    ['What is the threshold for declaring shares in a company?', {}, 'Regs r.17'],
    ['Do I declare assets outside Kenya?', {}, 'Act First Schedule, note 13'],
    ['Who counts as a dependent child?', {}, 'Act First Schedule, para. 7'],
  ])('English: %s %o -> %s', async (q, options, expected) => {
    expect((await citations(q, options))[0]).toBe(expected);
  });

  it.each([
    [
      'Je, matatu ninayomiliki pamoja na ndugu yangu ni mali?',
      vehicleItem,
      'Act First Schedule, para. 8',
    ],
    ['Je, matatu ninayomiliki pamoja na ndugu yangu ni mali?', {}, 'Act First Schedule, note 13'],
    ['Je, natakiwa kutangaza mshahara wa mke wangu?', {}, 'Act First Schedule, para. 8'],
    ['Mabadiliko makubwa ni nini?', {}, 'Regs r.21'],
    ['Je, nitangaze mali ya nje ya nchi?', {}, 'Act First Schedule, note 13'],
    ['Je, nitangaze hisa katika kampuni?', {}, 'Regs r.17'],
    ['Watoto tegemezi ni akina nani?', {}, 'Act First Schedule, para. 7'],
  ])('Swahili: %s %o -> %s', async (q, options, expected) => {
    expect((await citations(q, { ...options, language: 'sw' }))[0]).toBe(expected);
  });

  it('keeps joint assets in the top three for the matatu question on the vehicle', async () => {
    expect((await citations(matatu, vehicleItem)).slice(0, 3)).toContain(
      'Act First Schedule, note 13',
    );
  });

  it('boosts passages tagged with the section and item the declarant is on', async () => {
    const plain = await citations(matatu);
    const onVehicle = await citations(matatu, vehicleItem);
    expect(plain.indexOf('Act First Schedule, para. 8')).toBeGreaterThan(0);
    expect(onVehicle.indexOf('Act First Schedule, para. 8')).toBe(0);
  });

  it('returns passages as the contract says, with English snippets of the law', async () => {
    const response = await search('Do I declare assets outside Kenya?');
    const body = response.json<HelpPassage[]>();
    expect(contractErrors(okResponse('/v1/help/search', 'get'), body)).toEqual([]);
    expect(body.length).toBeGreaterThan(0);
    expect(body.length).toBeLessThanOrEqual(8);
    expect(body[0]).toMatchObject({
      source: 'act',
      citation: 'Act First Schedule, note 13',
      title: 'Guideline 13',
      language: 'en',
    });
    expect(body[0]?.snippet).toContain('outside Kenya');
  });

  it('honours limit and refuses a query that is too short', async () => {
    const params = new URLSearchParams({ q: 'assets', language: 'en', limit: '2' });
    const limited = await api.get(`/v1/help/search?${params.toString()}`, pscDeclarant);
    expect(limited.json<HelpPassage[]>()).toHaveLength(2);
    expect((await search('a')).statusCode).toBe(400);
    expect((await search('assets', { language: 'fr' as 'en' })).statusCode).toBe(400);
  });
});

describe('S6 / S9 effective dates and the corpus import', () => {
  /** The committed corpus with an amended Regs r.21 in force from 1 July 2027. */
  function amendedCorpus(): CorpusFile[] {
    return loadCorpus().map((file) =>
      file.source !== 'regs'
        ? file
        : {
            ...file,
            passages: [
              ...file.passages,
              {
                citation: 'Regs r.21',
                title: 'Declaration of material change',
                text: 'A material change shall be specified by the declarant in the material change schedule of the electronic declaration.',
                tags: ['material-change', 'other'],
                effectiveFrom: '2027-07-01',
              },
            ],
          },
    );
  }

  const importCorpus = () =>
    api.request('POST', '/v1/help/corpus/import', { ...platformAdmin, sub: 'platform-admin-1' });

  it('imports the committed corpus on boot, each wording with its version and effective dates', async () => {
    const response = await api.get('/v1/help/corpus', platformAdmin);
    expect(response.statusCode).toBe(200);
    const passages = response.json<CorpusPassageView[]>();
    expect(contractErrors(okResponse('/v1/help/corpus', 'get'), passages)).toEqual([]);
    const committed = loadCorpus();
    expect(passages).toHaveLength(committed.flatMap((file) => file.passages).length);
    expect(passages.find((passage) => passage.citation === 'Regs r.21')).toMatchObject({
      source: 'regs',
      effectiveFrom: '2026-03-26',
      effectiveTo: null,
      version: corpusVersion(committed),
    });
  });

  it('re-imports the same files as a no-op', async () => {
    const response = await importCorpus();
    expect(response.statusCode).toBe(200);
    expect(response.json<CorpusImportResult>()).toMatchObject({
      version: corpusVersion(loadCorpus()),
      skipped: true,
    });
    const audited = await api.asPlatform((tx) =>
      tx.select().from(outbox).where(eq(outbox.eventType, 'help.corpus.imported.v1')),
    );
    expect(audited).toEqual([]);
  });

  it('versions an amendment: the earlier wording ends when it takes effect, and search reads the law in force', async () => {
    try {
      api.corpus.set(amendedCorpus());
      const imported = await importCorpus();
      expect(imported.json<CorpusImportResult>()).toMatchObject({
        version: corpusVersion(amendedCorpus()),
        skipped: false,
        inserted: 1,
        updated: 1,
        removed: 0,
      });
      const audited = await api.asPlatform((tx) =>
        tx
          .select({ envelope: outbox.envelope })
          .from(outbox)
          .where(eq(outbox.eventType, 'help.corpus.imported.v1')),
      );
      expect(audited.map(({ envelope }) => envelope)).toEqual([
        expect.objectContaining({
          subject: corpusVersion(amendedCorpus()),
          tenant: 'platform',
          data: {
            version: corpusVersion(amendedCorpus()),
            inserted: 1,
            updated: 1,
            removed: 0,
            trigger: 'request',
            by: 'platform-admin-1',
          },
        }),
      ]);

      const wordings = (await api.get('/v1/help/corpus', platformAdmin))
        .json<CorpusPassageView[]>()
        .filter((passage) => passage.citation === 'Regs r.21');
      expect(
        wordings.map(({ effectiveFrom, effectiveTo, version }) => ({
          effectiveFrom,
          effectiveTo,
          version,
        })),
      ).toEqual([
        {
          effectiveFrom: '2026-03-26',
          effectiveTo: '2027-07-01',
          version: corpusVersion(amendedCorpus()),
        },
        { effectiveFrom: '2027-07-01', effectiveTo: null, version: corpusVersion(amendedCorpus()) },
      ]);

      const r21 = async (options: SearchOptions) => {
        const response = await search('What counts as a material change?', options);
        return response.json<HelpPassage[]>().filter((passage) => passage.citation === 'Regs r.21');
      };
      const before = await r21({ date: '2027-06-30' });
      expect(before).toHaveLength(1);
      expect(before[0]?.snippet).toContain('paragraph 9');
      const after = await r21({ date: '2027-07-01' });
      expect(after).toHaveLength(1);
      expect(after[0]?.snippet).toContain('electronic declaration');
      expect(after[0]?.id).not.toBe(before[0]?.id);

      // Without a date, today (Nairobi) decides.
      api.clock.setToday('2027-08-15');
      expect((await r21({}))[0]?.id).toBe(after[0]?.id);
    } finally {
      api.corpus.reset();
      await importCorpus();
    }
    const restored = await api.asPlatform((tx) =>
      tx.select().from(corpusPassages).where(eq(corpusPassages.citation, 'Regs r.21')),
    );
    expect(restored.map((row) => row.effectiveTo)).toEqual([null]);
  });
});

describe('S6 / S9 Commission and platform articles', () => {
  async function publish(slug: string, input: HelpArticleInput, caller: Caller) {
    const response = await api.request('POST', articles(slug), caller, {
      headers: freshKey(),
      body: input,
    });
    expect(response.statusCode).toBe(201);
    return response.json<HelpArticle>();
  }

  it("a published Commission article reaches that Commission's declarants only", async () => {
    const created = await publish('psc', article(), pscAdmin);
    expect(created).toMatchObject({ tenant: 'psc', version: 1, published: true });

    const forPsc = (await search('Where do I find my personnel file number?')).json<
      HelpPassage[]
    >();
    expect(forPsc[0]).toMatchObject({
      id: created.id,
      source: 'help',
      citation: 'Help: Personnel file numbers',
      language: 'en',
    });
    expect(
      await citations('Where do I find my personnel file number?', {}, tscDeclarant),
    ).not.toContain('Help: Personnel file numbers');
  });

  it('records help.article.published.v1 with identifiers only, once, when an article is published', async () => {
    const draft = await publish('psc', article({ published: false }), pscAdmin);
    expect(await citations('personnel file number')).not.toContain('Help: Personnel file numbers');

    const published = await api.request('PUT', `${articles('psc')}/${draft.id}`, pscAdmin, {
      body: article({ published: true }),
    });
    expect(published.statusCode).toBe(200);
    expect(published.json<HelpArticle>()).toMatchObject({ version: 2, published: true });
    await api.request('PUT', `${articles('psc')}/${draft.id}`, pscAdmin, {
      body: article({ published: true, title: 'File numbers' }),
    });

    const events = await api.asPlatform((tx) =>
      tx
        .select({ envelope: outbox.envelope })
        .from(outbox)
        .where(eq(outbox.eventType, 'help.article.published.v1')),
    );
    expect(events.map(({ envelope }) => envelope)).toEqual([
      expect.objectContaining({
        subject: draft.id,
        tenant: 'psc',
        data: { articleId: draft.id, tenant: 'psc' },
      }),
    ]);
    expect(await citations('personnel file number')).toContain('Help: File numbers');
  });

  it('creates an article once per Idempotency-Key: a retry replays it, a request without one is 400', async () => {
    const admin: Caller = { ...pscAdmin, sub: 'psc-admin-1' };
    const headers = freshKey();
    const first = await api.request('POST', articles('psc'), admin, {
      headers,
      body: article(),
    });
    const retry = await api.request('POST', articles('psc'), admin, {
      headers,
      body: article(),
    });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json<HelpArticle>().id).toBe(first.json<HelpArticle>().id);
    expect((await api.get(articles('psc'), pscAdmin)).json<HelpArticle[]>()).toHaveLength(1);

    for (const [path, caller] of [
      [articles('psc'), pscAdmin],
      ['/v1/help/articles', platformAdmin],
    ] as const) {
      const unkeyed = await api.request('POST', path, caller, { body: article() });
      expect(unkeyed.statusCode).toBe(400);
    }
  });

  it('records the audit trail of every write to an article, identifiers only', async () => {
    const admin: Caller = { ...pscAdmin, sub: 'psc-admin-1' };
    const created = await publish('psc', article({ published: false }), admin);
    await api.request('PUT', `${articles('psc')}/${created.id}`, admin, {
      body: article({ published: false, title: 'File numbers' }),
    });
    await api.request('DELETE', `${articles('psc')}/${created.id}`, admin);

    const events = await api.asPlatform((tx) =>
      tx
        .select({ type: outbox.eventType, envelope: outbox.envelope })
        .from(outbox)
        .orderBy(asc(outbox.createdAt)),
    );
    const record = (type: string, version: number) => ({
      type,
      subject: created.id,
      tenant: 'psc',
      data: { articleId: created.id, tenant: 'psc', version, published: false, by: 'psc-admin-1' },
    });
    expect(
      events.map(({ type, envelope: { subject, tenant, data } }) => ({
        type,
        subject,
        tenant,
        data,
      })),
    ).toEqual([
      record('help.article.created.v1', 1),
      record('help.article.updated.v1', 2),
      record('help.article.deleted.v1', 2),
    ]);
  });

  it('a platform article reaches every declarant', async () => {
    const response = await api.request('POST', '/v1/help/articles', platformAdmin, {
      headers: freshKey(),
      body: article({
        title: 'Signing in',
        bodyEn: 'Sign in with the one-time code we email you.',
        tags: [],
      }),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<HelpArticle>().tenant).toBeNull();
    for (const declarant of [pscDeclarant, tscDeclarant]) {
      expect(await citations('How do I sign in with a one-time code?', {}, declarant)).toContain(
        'Help: Signing in',
      );
    }
  });

  it('indexes a Swahili body in simple and answers a Swahili question with it', async () => {
    await publish(
      'psc',
      article({
        bodySw:
          'Nambari ya faili yako iko kwenye hati ya mshahara. Idara ya rasilimali watu huitoa unapoajiriwa.',
      }),
      pscAdmin,
    );
    const body = (await search('Nambari ya faili iko wapi?', { language: 'sw' })).json<
      HelpPassage[]
    >();
    expect(body[0]).toMatchObject({ citation: 'Help: Personnel file numbers', language: 'sw' });
    expect(body[0]?.snippet).toContain('Nambari ya faili');
  });

  it('leaves out articles not yet or no longer in force', async () => {
    await publish('psc', article({ effectiveFrom: '2027-01-01' }), pscAdmin);
    await publish(
      'psc',
      article({
        title: 'Old file numbers',
        effectiveFrom: '2025-01-01',
        effectiveTo: '2026-01-01',
      }),
      pscAdmin,
    );
    const onDay = (date: string) => citations('personnel file number', { date });
    expect(await onDay('2026-06-01')).not.toContain('Help: Personnel file numbers');
    expect(await onDay('2026-06-01')).not.toContain('Help: Old file numbers');
    expect(await onDay('2027-02-01')).toContain('Help: Personnel file numbers');
    expect(await onDay('2025-06-01')).toContain('Help: Old file numbers');
  });

  it('lists, updates and deletes a Commission article for its administrators', async () => {
    const created = await publish('psc', article({ published: false }), pscAdmin);
    await publish('tsc', article({ title: 'TSC numbers' }), tscAdmin);
    await api.request('POST', '/v1/help/articles', platformAdmin, {
      headers: freshKey(),
      body: article({ title: 'Platform' }),
    });

    const listed = await api.get(articles('psc'), pscAdmin);
    expect(listed.statusCode).toBe(200);
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/help/articles', 'get'), listed.json()),
    ).toEqual([]);
    expect(listed.json<HelpArticle[]>().map((a) => a.id)).toEqual([created.id]);

    const invalid = await api.request('PUT', `${articles('psc')}/${created.id}`, pscAdmin, {
      body: article({ effectiveTo: '2025-01-01', tags: ['not-a-tag' as 'bio'] }),
    });
    expect(invalid.statusCode).toBe(400);

    const deleted = await api.request('DELETE', `${articles('psc')}/${created.id}`, pscAdmin);
    expect(deleted.statusCode).toBe(204);
    expect((await api.get(articles('psc'), pscAdmin)).json<HelpArticle[]>()).toEqual([]);
  });
});

describe('S10 authorisation', () => {
  it('help search is for declarants: staff and platform tokens without a person get 404', async () => {
    expect((await search('assets', {}, pscDeclarant)).statusCode).toBe(200);
    for (const caller of [pscAdmin, pscOfficer, platformAdmin]) {
      expect((await search('assets', {}, caller)).statusCode).toBe(404);
    }
    expect((await api.anonymous('/v1/help/search?q=assets&language=en')).statusCode).toBe(401);
  });

  it('Commission articles: its administrators edit, its reporting officers read, anyone else 404', async () => {
    const created = (
      await api.request('POST', articles('psc'), pscAdmin, { headers: freshKey(), body: article() })
    ).json<HelpArticle>();
    const one = `${articles('psc')}/${created.id}`;

    expect((await api.get(articles('psc'), pscOfficer)).statusCode).toBe(200);
    for (const caller of [pscReviewer, tscAdmin, pscDeclarant, platformAdmin]) {
      expect((await api.get(articles('psc'), caller)).statusCode).toBe(404);
      expect(
        (
          await api.request('POST', articles('psc'), caller, {
            headers: freshKey(),
            body: article(),
          })
        ).statusCode,
      ).toBe(404);
      expect((await api.request('PUT', one, caller, { body: article() })).statusCode).toBe(404);
      expect((await api.request('DELETE', one, caller)).statusCode).toBe(404);
    }

    expect(
      (
        await api.request('POST', articles('psc'), pscOfficer, {
          headers: freshKey(),
          body: article(),
        })
      ).statusCode,
    ).toBe(403);
    expect((await api.request('PUT', one, pscOfficer, { body: article() })).statusCode).toBe(403);
    expect((await api.request('DELETE', one, pscOfficer)).statusCode).toBe(403);

    // Another Commission's article is not found through this Commission's routes.
    const tscArticle = (
      await api.request('POST', articles('tsc'), tscAdmin, { headers: freshKey(), body: article() })
    ).json<HelpArticle>();
    expect(
      (
        await api.request('PUT', `${articles('psc')}/${tscArticle.id}`, pscAdmin, {
          body: article(),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api.request('DELETE', `${articles('psc')}/not-a-uuid`, pscAdmin)).statusCode,
    ).toBe(404);
  });

  it('platform articles and the corpus are platform-admin only: anyone else 403', async () => {
    const created = await api.request('POST', '/v1/help/articles', platformAdmin, {
      headers: freshKey(),
      body: article(),
    });
    expect(created.statusCode).toBe(201);
    const one = `/v1/help/articles/${created.json<HelpArticle>().id}`;
    expect((await api.get('/v1/help/articles', platformAdmin)).statusCode).toBe(200);
    expect((await api.request('PUT', one, platformAdmin, { body: article() })).statusCode).toBe(
      200,
    );

    for (const caller of [pscAdmin, pscOfficer, pscDeclarant]) {
      expect((await api.get('/v1/help/articles', caller)).statusCode).toBe(403);
      expect(
        (
          await api.request('POST', '/v1/help/articles', caller, {
            headers: freshKey(),
            body: article(),
          })
        ).statusCode,
      ).toBe(403);
      expect((await api.request('PUT', one, caller, { body: article() })).statusCode).toBe(403);
      expect((await api.request('DELETE', one, caller)).statusCode).toBe(403);
      expect((await api.get('/v1/help/corpus', caller)).statusCode).toBe(403);
      expect((await api.request('POST', '/v1/help/corpus/import', caller)).statusCode).toBe(403);
    }
    expect((await api.request('DELETE', one, platformAdmin)).statusCode).toBe(204);
  });
});

describe('#549 one passage or article in full (getHelpPassage)', () => {
  const passagePath = (id: string, params: Record<string, string> = { language: 'en' }) =>
    `/v1/help/passages/${encodeURIComponent(id)}?${new URLSearchParams(params).toString()}`;

  async function publish(slug: string, input: HelpArticleInput) {
    const path = slug === 'platform' ? '/v1/help/articles' : articles(slug);
    const response = await api.request(
      'POST',
      path,
      slug === 'platform' ? platformAdmin : pscAdmin,
      {
        headers: freshKey(),
        body: input,
      },
    );
    expect(response.statusCode).toBe(201);
    return response.json<HelpArticle>();
  }

  // The read model holds every Commission, as the directory's events keep it.
  beforeEach(async () => {
    await api.asPlatform((tx) =>
      tx
        .insert(commissionRefs)
        .values({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' })
        .onConflictDoNothing(),
    );
  });

  /** A wording of the committed corpus in force today (the Act's first section). */
  async function actPassage() {
    const [row] = await api.asPlatform((tx) =>
      tx.select().from(corpusPassages).where(eq(corpusPassages.citation, 'Act s.30')),
    );
    if (!row) throw new Error('no Act s.30 in the corpus');
    return row;
  }

  async function detail(id: string, params?: Record<string, string>, caller = pscDeclarant) {
    const response = await api.get(passagePath(id, params), caller);
    expect(response.statusCode).toBe(200);
    const body = response.json<HelpPassageDetail>();
    expect(contractErrors(okResponse('/v1/help/passages/{passageId}', 'get'), body)).toEqual([]);
    return body;
  }

  it('reads a statutory passage in full, in English where it has no Swahili', async () => {
    const act = await actPassage();
    expect(await detail(act.id, { language: 'sw' })).toEqual({
      id: act.id,
      source: 'act',
      citation: 'Act s.30',
      title: act.title,
      text: act.textEn,
      language: 'en',
      tags: act.tags,
      commission: null,
      effectiveFrom: act.effectiveFrom,
      effectiveTo: act.effectiveTo,
    });
  });

  it("gives a passage's Swahili wording where the corpus has it", async () => {
    const act = await actPassage();
    await api.asPlatform((tx) =>
      tx
        .update(corpusPassages)
        .set({ textSw: 'Maandishi ya Kiswahili ya kifungu hiki.' })
        .where(eq(corpusPassages.id, act.id)),
    );
    expect(await detail(act.id, { language: 'sw' })).toMatchObject({
      text: 'Maandishi ya Kiswahili ya kifungu hiki.',
      language: 'sw',
    });
    expect(await detail(act.id, { language: 'en' })).toMatchObject({
      text: act.textEn,
      language: 'en',
    });
  });

  it('reads a platform article in full, its Swahili body when asked', async () => {
    const created = await publish(
      'platform',
      article({ title: 'Joint assets', bodySw: 'Mali ya pamoja na mwenzi wako.' }),
    );
    expect(await detail(created.id)).toMatchObject({
      id: created.id,
      source: 'help',
      citation: 'Help: Joint assets',
      title: 'Joint assets',
      text: created.bodyEn,
      language: 'en',
      commission: null,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    });
    expect(await detail(created.id, { language: 'sw' })).toMatchObject({
      text: 'Mali ya pamoja na mwenzi wako.',
      language: 'sw',
    });
  });

  it("carries the Commission of a Commission's article", async () => {
    const created = await publish('psc', article());
    expect((await detail(created.id)).commission).toEqual({
      slug: 'psc',
      issuerCode: 'PSC',
      name: 'Public Service Commission',
    });
  });

  it("is 404 for another Commission's article, an unpublished or superseded one, a wording not in force, an unknown id", async () => {
    const pscArticle = await publish('psc', article());
    const draft = await publish('psc', article({ title: 'Draft', published: false }));
    const old = await publish(
      'psc',
      article({ title: 'Old', effectiveFrom: '2025-01-01', effectiveTo: '2026-01-01' }),
    );
    const notFound = async (id: string, params?: Record<string, string>, caller = pscDeclarant) => {
      expect((await api.get(passagePath(id, params), caller)).statusCode).toBe(404);
    };

    await notFound(pscArticle.id, undefined, tscDeclarant);
    await notFound(draft.id);
    await notFound(old.id, { language: 'en', date: '2026-06-01' });
    expect((await detail(old.id, { language: 'en', date: '2025-06-01' })).citation).toBe(
      'Help: Old',
    );
    const act = await actPassage();
    await notFound(act.id, { language: 'en', date: '2020-01-01' });
    await notFound(randomUUID());
    await notFound('not-a-passage');
  });

  it("does not hide a Commission's article when the read model lacks its Commission: it fails", async () => {
    const created = await publish('psc', article());
    await api.asPlatform((tx) => tx.delete(commissionRefs).where(eq(commissionRefs.slug, 'psc')));
    expect((await api.get(passagePath(created.id), pscDeclarant)).statusCode).toBe(500);
  });

  it('is for declarants: staff and platform tokens without a person get 404', async () => {
    const act = await actPassage();
    for (const caller of [pscAdmin, pscReviewer, platformAdmin]) {
      expect((await api.get(passagePath(act.id), caller)).statusCode).toBe(404);
    }
  });

  it('refuses a bad language or date', async () => {
    const act = await actPassage();
    const invalid: Record<string, string>[] = [
      { language: 'fr' },
      { language: 'en', date: '1 June 2026' },
      {},
    ];
    for (const params of invalid) {
      expect((await api.get(passagePath(act.id, params), pscDeclarant)).statusCode).toBe(400);
    }
  });
});
