import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  discardDeclaration,
  linkAttachment,
  listDeclarations,
  loadDeclaration,
  loadPreviousDeclaration,
  loadSection,
  loadSummary,
  previousDeclarationOf,
  saveSection,
  type SaveOutcome,
  startDeclaration,
  unlinkAttachment,
} from './declarations.server';
import {
  editElsewhere,
  failNextSaves,
  MOCK_OBLIGATIONS,
  mockDeclarationsFetch,
  resetDeclarationsMock,
} from './declarations/mock.server';
import type { paths } from './declarations/schema.gen';
import type { Declaration, DeclarationListItem } from './declarations/types';
import { mockDocumentsFetch, resetDocumentsMock } from './documents/mock.server';
import type { paths as documentPaths } from './documents/schema.gen';
import type { CreateUpload } from './documents/types';

function client(send: (request: Request) => Promise<Response> = mockDeclarationsFetch) {
  return createClient<paths>({ baseUrl: 'http://declarations.test', fetch: send });
}

const documents = createClient<documentPaths>({
  baseUrl: 'http://documents.test',
  fetch: mockDocumentsFetch,
});

async function start(obligationId: string = MOCK_OBLIGATIONS.biennial) {
  const result = await startDeclaration(client(), obligationId);
  if (result.status !== 'started') throw new Error(result.status);
  const loaded = await loadDeclaration(client(), result.declaration.id);
  if (loaded.status !== 'ok') throw new Error(loaded.status);
  return loaded;
}

function saved(outcome: SaveOutcome) {
  if (outcome.status !== 'saved') throw new Error(outcome.status);
  return outcome;
}

const officerSections = (declaration: Declaration) =>
  declaration.sections.map((section) => [section.key, section.completeness]);

beforeEach(() => {
  resetDeclarationsMock();
  resetDocumentsMock();
});

describe('starting a declaration (S1, S3)', () => {
  it('creates a draft with a pre-filled bio, then returns the same draft', async () => {
    const first = await startDeclaration(client(), MOCK_OBLIGATIONS.biennial);
    expect(first).toMatchObject({
      status: 'started',
      created: true,
      declaration: {
        type: 'biennial',
        statementDate: '2027-11-01',
        incomePeriod: { from: '2025-11-01', to: '2027-11-01', fromSource: 'assumed' },
        status: 'draft',
      },
    });
    if (first.status !== 'started') return;
    expect(officerSections(first.declaration)).toEqual([
      ['bio', 'not-started'],
      ['household', 'not-started'],
      ['statement:officer', 'not-started'],
      ['other', 'not-started'],
    ]);

    const again = await startDeclaration(client(), MOCK_OBLIGATIONS.biennial);
    expect(again).toMatchObject({ status: 'started', created: false });
    if (again.status === 'started') expect(again.declaration.id).toBe(first.declaration.id);

    const bio = await loadSection(client(), first.declaration.id, 'bio');
    expect(bio).toMatchObject({
      status: 'ok',
      section: {
        contents: {
          name: { surname: 'Kamau', firstName: 'Wanjiku', otherNames: 'Njoki' },
          employment: {
            designation: 'Deputy Principal',
            employer: 'Nyeri High School',
            responsibleCommission: 'tsc',
          },
        },
      },
    });
  });

  it('S8: pre-fills the HR fields a roster has, and leaves them out when it has none', async () => {
    const tsc = await start(MOCK_OBLIGATIONS.biennial);
    expect(await loadSection(client(), tsc.declaration.id, 'bio')).toMatchObject({
      section: {
        contents: {
          maritalStatus: 'married',
          employment: {
            jobGroup: 'D3 (T-Scale 13)',
            appointmentDate: '2026-09-02',
            workStation: 'Eldoret, Uasin Gishu',
          },
        },
      },
    });

    const psc = await start(MOCK_OBLIGATIONS.initial);
    const bio = await loadSection(client(), psc.declaration.id, 'bio');
    if (bio.status !== 'ok') throw new Error('no bio');
    expect(bio.section.contents).not.toHaveProperty('maritalStatus');
    expect(bio.section.contents.employment).not.toHaveProperty('jobGroup');
  });

  it('S11: starts the PSC statement with assets from registries', async () => {
    const { declaration } = await start(MOCK_OBLIGATIONS.initial);
    const statement = await loadSection(client(), declaration.id, 'statement:officer');
    expect(statement).toMatchObject({
      section: {
        contents: {
          assets: [
            { type: 'vehicle', details: { registration: 'KCA 123A' }, source: { kind: 'ntsa' } },
            { type: 'land', source: { kind: 'ardhisasa' } },
          ],
        },
      },
    });
  });

  it('refuses filed and cancelled obligations', async () => {
    expect(await startDeclaration(client(), MOCK_OBLIGATIONS.filed)).toEqual({
      status: 'not-open',
    });
    expect(await startDeclaration(client(), MOCK_OBLIGATIONS.cancelled)).toEqual({
      status: 'not-open',
    });
    expect(await startDeclaration(client(), crypto.randomUUID())).toEqual({
      status: 'not-found',
    });
  });
});

describe('drafts belong to the declarant who started them, as in the service', () => {
  /** A client signed in as `personId` (an unsigned token, as the mock reads it). */
  function as(personId: string) {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return createClient<paths>({
      baseUrl: 'http://declarations.test',
      fetch: mockDeclarationsFetch,
      headers: {
        authorization: `Bearer ${part({ alg: 'none' })}.${part({ person_id: personId })}.x`,
      },
    });
  }
  const wanjiku = () => as('5b0c8f7e-3f5d-4d59-9a53-0d6c1f0b2a11');
  const grace = () => as('8d7f3a90-2b1c-4e5d-a6f7-9081a2b3c4d5');

  it("lists only the caller's drafts and answers 404 to anyone else's", async () => {
    const started = await startDeclaration(wanjiku(), MOCK_OBLIGATIONS.initial);
    if (started.status !== 'started') throw new Error(started.status);
    const { id } = started.declaration;

    expect(await listDeclarations(wanjiku())).toMatchObject({
      status: 'ok',
      declarations: [{ id }],
    });
    expect(await listDeclarations(grace())).toEqual({ status: 'ok', declarations: [] });
    expect(await loadDeclaration(grace(), id)).toEqual({ status: 'not-found' });
    expect(await loadSection(grace(), id, 'bio')).toEqual({ status: 'not-found' });
  });

  it("pre-fills the bio from the caller's own roster entry", async () => {
    const started = await startDeclaration(grace(), MOCK_OBLIGATIONS.initial);
    if (started.status !== 'started') throw new Error(started.status);

    const bio = await loadSection(grace(), started.declaration.id, 'bio');
    expect(bio).toMatchObject({
      section: {
        contents: {
          name: { surname: 'Njeri', firstName: 'Grace', otherNames: 'Wambui' },
          employment: { personnelFileNumber: 'PSC/2009/118204' },
        },
      },
    });
  });
});

describe('saving a section (S4)', () => {
  it('bumps the ETag on every save and answers 412 to a stale one', async () => {
    const { declaration, etag } = await start();
    const bio = await loadSection(client(), declaration.id, 'bio');
    if (bio.status !== 'ok') throw new Error(bio.status);

    const first = saved(
      await saveSection(client(), {
        declarationId: declaration.id,
        sectionKey: 'bio',
        ifMatch: etag,
        contents: { ...bio.section.contents, birth: { date: '1980-04-02', place: 'Nyeri' } },
      }),
    );
    expect(first.etag).not.toBe(etag);
    expect(first.result).toMatchObject({ key: 'bio', completeness: 'incomplete' });

    const stale = await saveSection(client(), {
      declarationId: declaration.id,
      sectionKey: 'bio',
      ifMatch: etag,
      contents: bio.section.contents,
    });
    expect(stale).toEqual({ status: 'conflict' });
  });

  it('answers 412 after an edit on another device', async () => {
    const { declaration, etag } = await start();
    editElsewhere(declaration.id);
    expect(
      await saveSection(client(), {
        declarationId: declaration.id,
        sectionKey: 'other',
        ifMatch: etag,
        contents: {},
      }),
    ).toEqual({ status: 'conflict' });
  });

  it('refuses a changed roster name with identity-locked-field', async () => {
    const { declaration, etag } = await start();
    const outcome = await saveSection(client(), {
      declarationId: declaration.id,
      sectionKey: 'bio',
      ifMatch: etag,
      contents: { name: { surname: 'Otieno', firstName: 'Mwangi' } },
    });
    expect(outcome).toEqual({ status: 'rejected', code: 'identity-locked-field' });
  });

  it('reports a failing service as unavailable', async () => {
    const { declaration, etag } = await start();
    failNextSaves(1);
    expect(
      await saveSection(client(), {
        declarationId: declaration.id,
        sectionKey: 'other',
        ifMatch: etag,
        contents: {},
      }),
    ).toEqual({ status: 'unavailable' });
    const broken = () => Promise.reject(new Error('offline'));
    expect(await loadDeclaration(client(broken), declaration.id)).toEqual({
      status: 'unavailable',
    });
  });

  it('marks the bio complete once paragraphs 2-5 are filled', async () => {
    const { declaration, etag } = await start();
    const bio = await loadSection(client(), declaration.id, 'bio');
    if (bio.status !== 'ok') throw new Error(bio.status);
    const contents = bio.section.contents as Record<string, Record<string, unknown>>;
    const outcome = saved(
      await saveSection(client(), {
        declarationId: declaration.id,
        sectionKey: 'bio',
        ifMatch: etag,
        contents: {
          ...contents,
          birth: { date: '1980-04-02', place: 'Nyeri' },
          maritalStatus: 'married',
          address: { postal: 'P.O. Box 12-10100, Nyeri', physical: 'Ruring’u estate, Nyeri' },
          employment: { ...contents.employment, nature: 'permanent' },
        },
      }),
    );
    expect(outcome.result).toMatchObject({ completeness: 'complete', issues: [] });
  });
});

describe('household and statements (S5, S8)', () => {
  it('creates statements for spouses and included children and archives removed ones', async () => {
    const { declaration, etag } = await start();
    const spouse = crypto.randomUUID();
    const child = crypto.randomUUID();
    const adult = crypto.randomUUID();
    const first = saved(
      await saveSection(client(), {
        declarationId: declaration.id,
        sectionKey: 'household',
        ifMatch: etag,
        contents: {
          spouses: {
            none: false,
            items: [
              { id: spouse, name: { surname: 'Kamau', firstName: 'Mary' }, separated: false },
            ],
          },
          children: {
            none: false,
            items: [
              {
                id: child,
                name: { surname: 'Kamau', firstName: 'Tom' },
                dateOfBirth: '2015-01-01',
              },
              // 18 on the statement date: not included.
              {
                id: adult,
                name: { surname: 'Kamau', firstName: 'Ann' },
                dateOfBirth: '2009-11-01',
              },
            ],
          },
        },
      }),
    );
    expect(first.result.sectionsChanged).toEqual([
      { key: `statement:spouse:${spouse}`, action: 'created' },
      { key: `statement:child:${child}`, action: 'created' },
    ]);

    const second = saved(
      await saveSection(client(), {
        declarationId: declaration.id,
        sectionKey: 'household',
        ifMatch: first.etag,
        contents: { spouses: { none: true, items: [] }, children: { none: true, items: [] } },
      }),
    );
    expect(second.result.sectionsChanged).toEqual([
      { key: `statement:spouse:${spouse}`, action: 'archived' },
      { key: `statement:child:${child}`, action: 'archived' },
    ]);
    const loaded = await loadDeclaration(client(), declaration.id);
    if (loaded.status !== 'ok') throw new Error(loaded.status);
    expect(officerSections(loaded.declaration)).toContainEqual([
      `statement:spouse:${spouse}`,
      'archived',
    ]);
  });

  it('refuses a nil flag with items', async () => {
    const { declaration, etag } = await start();
    const outcome = await saveSection(client(), {
      declarationId: declaration.id,
      sectionKey: 'statement:officer',
      ifMatch: etag,
      contents: { assetsNil: true, assets: [{ id: crypto.randomUUID(), type: 'cash' }] },
    });
    expect(outcome).toEqual({ status: 'rejected', code: 'nil-conflicts-with-items' });
  });
});

describe('attachments (S10)', () => {
  it('links a clean upload to an item, refuses an infected one and unlinks', async () => {
    const { declaration, etag } = await start();
    const itemId = crypto.randomUUID();
    saved(
      await saveSection(client(), {
        declarationId: declaration.id,
        sectionKey: 'statement:officer',
        ifMatch: etag,
        contents: { assets: [{ id: itemId, type: 'land', description: 'Plot' }] },
      }),
    );

    async function upload(fileName: string) {
      const { data } = await documents.POST('/v1/uploads', {
        params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: {
          purpose: 'declaration-attachment',
          contentType: 'application/pdf',
          declaredSize: 2048,
          fileName,
        } satisfies CreateUpload as never,
      });
      if (!data) throw new Error('no reservation');
      await documents.POST('/v1/uploads/{id}/complete', {
        params: { path: { id: data.id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      });
      return data.id;
    }

    const input = { declarationId: declaration.id, sectionKey: 'statement:officer', itemId };
    const linked = await linkAttachment(client(), { ...input, uploadId: await upload('deed.pdf') });
    expect(linked).toMatchObject({ status: 'linked', attachment: { fileName: 'deed.pdf' } });
    expect(
      await linkAttachment(client(), { ...input, uploadId: await upload('virus.pdf') }),
    ).toEqual({ status: 'refused' });

    if (linked.status !== 'linked') return;
    // The item's reference carries the link's id, so a later visit can unlink it.
    const assets = async () => {
      const section = await loadSection(client(), declaration.id, 'statement:officer');
      if (section.status !== 'ok') throw new Error(section.status);
      return section.section.contents.assets;
    };
    expect(await assets()).toEqual([
      expect.objectContaining({
        id: itemId,
        attachments: [
          {
            attachmentId: linked.attachment.id,
            uploadId: linked.attachment.uploadId,
            fileName: 'deed.pdf',
            sha256: linked.attachment.sha256,
          },
        ],
      }),
    ]);
    const unlink = () =>
      unlinkAttachment(client(), {
        declarationId: declaration.id,
        attachmentId: linked.attachment.id,
      });
    expect(await unlink()).toEqual({ status: 'unlinked' });
    expect(await assets()).toEqual([expect.objectContaining({ id: itemId, attachments: [] })]);
    expect(await unlink()).toEqual({ status: 'not-found' });
  });
});

describe('summary, list and discard (S12, S15, S16)', () => {
  it('lists drafts, summarises them and discards', async () => {
    const { declaration } = await start();

    const list = await listDeclarations(client());
    expect(list).toMatchObject({
      status: 'ok',
      declarations: [{ id: declaration.id, status: 'draft', completenessPercent: 0 }],
    });

    const summary = await loadSummary(client(), declaration.id);
    expect(summary).toMatchObject({ status: 'ok', summary: { canSubmit: false, valid: false } });

    expect(await discardDeclaration(client(), declaration.id)).toEqual({ status: 'discarded' });
    expect(await loadDeclaration(client(), declaration.id)).toEqual({ status: 'not-found' });
    expect(await listDeclarations(client())).toEqual({ status: 'ok', declarations: [] });

    const fresh = await startDeclaration(client(), MOCK_OBLIGATIONS.biennial);
    expect(fresh).toMatchObject({ status: 'started', created: true });
  });
});

describe('the previous declaration, to compare with (ADR-006 point 10)', () => {
  const listed = (id: string, statementDate: string, currentVersion: number | null) => ({
    id,
    statementDate,
    currentVersion,
    reference: currentVersion === null ? null : `DCB-TSC-${statementDate.slice(0, 4)}-0000001-B`,
    type: 'biennial',
    submittedAt: currentVersion === null ? null : `${statementDate}T09:00:00Z`,
  });
  const statements = [{ personKey: 'officer', assets: [{ id: 'a', type: 'land' }] }];

  /** The service with the given list; versions answer with the statements above. */
  function service(list: unknown[], versionStatus = 200) {
    const asked: string[] = [];
    const send = (request: Request) => {
      const path = new URL(request.url).pathname;
      asked.push(path);
      if (path === '/v1/me/declarations') return Promise.resolve(Response.json(list));
      return Promise.resolve(
        versionStatus === 200
          ? Response.json({ version: 2, document: { statements } })
          : new Response(null, { status: versionStatus }),
      );
    };
    return { client: client(send), asked };
  }

  it('reads the version in force of the declaration this one follows, and keeps its statements', async () => {
    const { client: declarations, asked } = service([
      listed('this', '2027-11-01', null),
      listed('previous', '2025-11-01', 2),
    ]);

    const result = await loadPreviousDeclaration(declarations, 'this');

    expect(asked).toEqual(['/v1/me/declarations', '/v1/declarations/previous/versions/2']);
    expect(result).toEqual({
      status: 'ok',
      previous: {
        declarationId: 'previous',
        version: 2,
        reference: 'DCB-TSC-2025-0000001-B',
        type: 'biennial',
        statementDate: '2025-11-01',
        submittedAt: '2025-11-01T09:00:00Z',
        statements,
      },
    });
  });

  it('is none for a first declaration, without reading any version', async () => {
    const { client: declarations, asked } = service([listed('this', '2027-11-01', null)]);

    expect(await loadPreviousDeclaration(declarations, 'this')).toEqual({
      status: 'ok',
      previous: null,
    });
    expect(asked).toEqual(['/v1/me/declarations']);
  });

  it('is unavailable when the version cannot be read', async () => {
    const { client: declarations } = service(
      [listed('this', '2027-11-01', null), listed('previous', '2025-11-01', 1)],
      503,
    );

    expect(await loadPreviousDeclaration(declarations, 'this')).toEqual({
      status: 'unavailable',
    });
  });
});

describe('previousDeclarationOf', () => {
  function listed(
    id: string,
    statementDate: string,
    currentVersion: number | null,
    submittedAt: string | null = currentVersion === null ? null : `${statementDate}T09:00:00Z`,
  ): DeclarationListItem {
    return { id, statementDate, currentVersion, submittedAt } as DeclarationListItem;
  }

  it('is the filed declaration with the latest statement date before this one', () => {
    const list = [
      listed('this', '2027-11-01', null),
      listed('older', '2023-11-01', 1),
      listed('previous', '2025-11-01', 2),
      listed('never-filed', '2026-06-01', null),
    ];

    expect(previousDeclarationOf(list, 'this')).toMatchObject({ id: 'previous' });
  });

  it('is none for the first declaration, or one not in the list', () => {
    expect(previousDeclarationOf([listed('this', '2027-11-01', null)], 'this')).toBeNull();
    expect(previousDeclarationOf([listed('older', '2025-11-01', 1)], 'this')).toBeNull();
  });

  it('is not the declaration itself while amending it', () => {
    const list = [listed('this', '2027-11-01', 1), listed('previous', '2025-11-01', 1)];

    expect(previousDeclarationOf(list, 'this')).toMatchObject({ id: 'previous' });
  });
});
