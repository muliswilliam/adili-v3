import createClient from 'openapi-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sourceDetails } from '../../../declaration/item-source';
import type { Item } from '../../../declaration/statement';
import { suggestionPatch } from '../../../declaration/suggestions';
import {
  acceptSuggestion,
  dismissSuggestion,
  extractAttachment,
  linkAttachment,
  listSuggestions,
  loadDeclaration,
  loadSection,
  type LoadedSuggestion,
  type LoadedSuggestionSet,
  type RegistryLookupsInput,
  requestLookups,
  saveSection,
  startDeclaration,
} from '../../declarations.server';
import {
  editElsewhere,
  MOCK_OBLIGATIONS,
  mockDeclarationsFetch,
  resetDeclarationsMock,
  setExtractionEnabled,
  setLookupDelay,
} from '../mock.server';
import type { paths } from '../schema.gen';
import { applyPatch } from './suggestions';
import { mockDocumentsFetch, resetDocumentsMock } from '../../documents/mock.server';
import type { paths as documentPaths } from '../../documents/schema.gen';
import type { CreateUpload } from '../../documents/types';
import { registryAnswer } from './suggestions';

const client = createClient<paths>({
  baseUrl: 'http://declarations.test',
  fetch: mockDeclarationsFetch,
});

const SPOUSE = '11111111-2222-4333-8444-555555555555';
const CHILD = '66666666-7777-4888-8999-000000000000';
const ALL = ['kra', 'ntsa', 'brs', 'ardhisasa'] as const;

async function start() {
  const started = await startDeclaration(client, MOCK_OBLIGATIONS.biennial);
  if (started.status !== 'started') throw new Error(started.status);
  const loaded = await loadDeclaration(client, started.declaration.id);
  if (loaded.status !== 'ok') throw new Error(loaded.status);
  return { declarationId: started.declaration.id, etag: loaded.etag };
}

async function etagOf(declarationId: string) {
  const loaded = await loadDeclaration(client, declarationId);
  if (loaded.status !== 'ok') throw new Error(loaded.status);
  return loaded.etag;
}

/** A spouse with a national ID and a child without one. */
async function withHousehold(declarationId: string, etag: string) {
  const outcome = await saveSection(client, {
    declarationId,
    sectionKey: 'household',
    ifMatch: etag,
    contents: {
      spouses: {
        none: false,
        items: [
          {
            id: SPOUSE,
            name: { surname: 'Kennedy', firstName: 'Mary' },
            nationalId: '23456789',
            separated: false,
          },
        ],
      },
      children: {
        none: false,
        items: [
          { id: CHILD, name: { surname: 'Kamau', firstName: 'Tom' }, dateOfBirth: '2015-01-01' },
        ],
      },
    },
  });
  if (outcome.status !== 'saved') throw new Error(outcome.status);
}

function lookup(declarationId: string, overrides: Partial<RegistryLookupsInput> = {}) {
  return requestLookups(client, {
    declarationId,
    personKey: 'officer',
    systems: [...ALL],
    textVersion: 'registry-consent.v1:kra+ntsa+brs+ardhisasa',
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  });
}

async function sets(declarationId: string, personKey = 'officer') {
  const result = await listSuggestions(client, { declarationId, personKey });
  if (result.status !== 'ok') throw new Error(result.status);
  return result.sets;
}

function all(found: LoadedSuggestionSet[]): LoadedSuggestion[] {
  return found.flatMap((set) => set.suggestions);
}

function byRegistration(found: LoadedSuggestionSet[], registration: string) {
  const suggestion = all(found).find(
    (each) => each.fields.registration === registration && each.status !== 'superseded',
  );
  if (!suggestion) throw new Error(`No suggestion for ${registration}`);
  return suggestion;
}

beforeEach(() => {
  resetDeclarationsMock();
  resetDocumentsMock();
  setLookupDelay(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('registry lookups (S1, S2)', () => {
  it('answers one pending set per registry, which the next read after the delay resolves', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-28T09:00:00Z'), toFake: ['Date'] });
    setLookupDelay(1_000);
    const { declarationId } = await start();
    const started = await lookup(declarationId);
    if (started.status !== 'started') throw new Error(started.status);
    expect(started.sets.map((set) => [set.source, set.status])).toEqual([
      ['kra', 'pending'],
      ['ntsa', 'pending'],
      ['brs', 'pending'],
      ['ardhisasa', 'pending'],
    ]);

    vi.setSystemTime(new Date('2026-09-28T09:00:01.200Z'));
    expect((await sets(declarationId)).map((set) => set.status)).toEqual([
      'ready',
      'pending',
      'pending',
      'pending',
    ]);

    vi.setSystemTime(new Date('2026-09-28T09:00:03Z'));
    const ready = await sets(declarationId);
    expect(ready.every((set) => set.status === 'ready' && set.verificationResultId)).toBe(true);
    expect(all(ready).map((each) => [each.itemType, each.sectionKey])).toEqual([
      ['bio-tax', 'bio'],
      ['vehicle', 'statement:officer'],
      ['vehicle', 'statement:officer'],
      ['shareholding', 'statement:officer'],
      ['land', 'statement:officer'],
      ['land', 'statement:officer'],
    ]);
  });

  it('replays a request with the same idempotency key', async () => {
    const { declarationId } = await start();
    const idempotencyKey = crypto.randomUUID();
    const first = await lookup(declarationId, { idempotencyKey });
    const again = await lookup(declarationId, { idempotencyKey });
    if (first.status !== 'started' || again.status !== 'started') throw new Error('not started');
    expect(again.sets.map((set) => set.id)).toEqual(first.sets.map((set) => set.id));
    expect(await sets(declarationId)).toHaveLength(4);
  });

  it('answers no-id for a household member without a national ID', async () => {
    const { declarationId, etag } = await start();
    await withHousehold(declarationId, etag);
    expect(await lookup(declarationId, { personKey: `child:${CHILD}` })).toEqual({
      status: 'no-id',
    });
  });

  it('runs for a spouse with an ID; ArdhiSasa is unavailable until retried', async () => {
    const { declarationId, etag } = await start();
    await withHousehold(declarationId, etag);
    const personKey = `spouse:${SPOUSE}`;
    await lookup(declarationId, { personKey });
    const first = await sets(declarationId, personKey);
    expect(first.map((set) => [set.source, set.status, set.suggestions.length])).toEqual([
      ['kra', 'ready', 1],
      ['ntsa', 'ready', 0],
      ['brs', 'ready', 0],
      ['ardhisasa', 'unavailable', 0],
    ]);
    expect(all(first)[0]?.sectionKey).toBe('household');

    await lookup(declarationId, { personKey, systems: ['ardhisasa'] });
    const retried = await sets(declarationId, personKey);
    expect(retried.at(-1)?.status).toBe('ready');
    expect(all(retried).at(-1)?.fields.parcelNumber).toBe('Eldoret Municipality Block 7/1234');
  });

  it('needs the declarant to request the check', async () => {
    const { declarationId } = await start();
    const response = await mockDeclarationsFetch(
      new Request(`http://declarations.test/v1/declarations/${declarationId}/suggestions/lookups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ personKey: 'officer', systems: ['kra'] }),
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('consent-required');
  });

  it('has nothing for a child', () => {
    expect(registryAnswer(`child:${CHILD}`, 'ntsa', 0)).toEqual([]);
  });
});

describe('accepting a suggestion (S4)', () => {
  it('adds the item with its source through the section save path', async () => {
    const { declarationId } = await start();
    await lookup(declarationId);
    const suggestion = byRegistration(await sets(declarationId), 'KCA 123A');
    const etag = await etagOf(declarationId);
    const outcome = await acceptSuggestion(client, {
      declarationId,
      suggestionId: suggestion.id,
      ifMatch: etag,
      fields: suggestion.fields,
      applyToItemId: null,
    });
    if (outcome.status !== 'accepted') throw new Error(outcome.status);
    expect(outcome.suggestion).toMatchObject({
      status: 'accepted',
      acceptedItemId: outcome.itemId,
    });
    expect(outcome.etag).not.toBe(etag);

    const section = await loadSection(client, declarationId, 'statement:officer');
    if (section.status !== 'ok') throw new Error(section.status);
    expect(section.etag).toBe(outcome.etag);
    expect(section.section.contents.assets).toEqual([
      {
        id: outcome.itemId,
        type: 'vehicle',
        description: 'Toyota Probox',
        location: { inKenya: true },
        change: { changed: false },
        joint: { isJoint: false },
        details: { registration: 'KCA 123A', makeModel: 'Toyota Probox, 2016' },
        source: {
          kind: 'ntsa',
          suggestionId: suggestion.id,
          verificationResultId: expect.any(String) as string,
          at: expect.any(String) as string,
        },
      },
    ]);
    expect(section.section.contents.assetsNil).toBe(false);
    const [accepted] = section.section.contents.assets as Item[];
    if (!accepted) throw new Error('no accepted item');
    expect(sourceDetails(accepted)).toMatchObject({ kind: 'ntsa', reference: 'KCA 123A' });
  });

  it('adds the edited fields', async () => {
    const { declarationId } = await start();
    await lookup(declarationId);
    const suggestion = byRegistration(await sets(declarationId), 'KCA 123A');
    const outcome = await acceptSuggestion(client, {
      declarationId,
      suggestionId: suggestion.id,
      ifMatch: await etagOf(declarationId),
      fields: { ...suggestion.fields, registration: 'KCA 128A', description: 'Family car' },
      applyToItemId: null,
    });
    if (outcome.status !== 'accepted') throw new Error(outcome.status);
    const section = await loadSection(client, declarationId, 'statement:officer');
    if (section.status !== 'ok') throw new Error(section.status);
    expect(section.section.contents.assets).toMatchObject([
      { description: 'Family car', details: { registration: 'KCA 128A' } },
    ]);
  });

  it('matches an item with the same identifier and fills only its empty fields', async () => {
    const { declarationId, etag } = await start();
    const itemId = crypto.randomUUID();
    const saved = await saveSection(client, {
      declarationId,
      sectionKey: 'statement:officer',
      ifMatch: etag,
      contents: {
        assets: [
          {
            id: itemId,
            type: 'vehicle',
            description: 'Our Fielder',
            details: { registration: 'kda-123x' },
          },
        ],
      },
    });
    if (saved.status !== 'saved') throw new Error(saved.status);
    await lookup(declarationId);
    const suggestion = byRegistration(await sets(declarationId), 'KDA 123X');
    expect(suggestion.matchItemId).toBe(itemId);

    const outcome = await acceptSuggestion(client, {
      declarationId,
      suggestionId: suggestion.id,
      ifMatch: saved.etag,
      fields: suggestion.fields,
      applyToItemId: itemId,
    });
    if (outcome.status !== 'accepted') throw new Error(outcome.status);
    expect(outcome.itemId).toBe(itemId);
    const section = await loadSection(client, declarationId, 'statement:officer');
    if (section.status !== 'ok') throw new Error(section.status);
    expect(section.section.contents.assets).toMatchObject([
      {
        id: itemId,
        description: 'Our Fielder',
        details: { registration: 'kda-123x', makeModel: 'Toyota Fielder, 2014' },
        source: { kind: 'ntsa', suggestionId: suggestion.id },
      },
    ]);
  });

  it('answers a conflict for a stale ETag or a suggestion no longer new', async () => {
    const { declarationId } = await start();
    await lookup(declarationId);
    const suggestion = byRegistration(await sets(declarationId), 'KCA 123A');
    const stale = await etagOf(declarationId);
    editElsewhere(declarationId);
    const input = {
      declarationId,
      suggestionId: suggestion.id,
      fields: suggestion.fields,
      applyToItemId: null,
    };
    expect(await acceptSuggestion(client, { ...input, ifMatch: stale })).toEqual({
      status: 'conflict',
      code: null,
    });
    const fresh = await etagOf(declarationId);
    expect((await acceptSuggestion(client, { ...input, ifMatch: fresh })).status).toBe('accepted');
    expect(
      await acceptSuggestion(client, { ...input, ifMatch: await etagOf(declarationId) }),
    ).toEqual({ status: 'conflict', code: 'not-new' });
  });

  it("writes a spouse's KRA PIN to Household; the officer's has nowhere to go", async () => {
    const { declarationId, etag } = await start();
    await withHousehold(declarationId, etag);
    await lookup(declarationId, { personKey: `spouse:${SPOUSE}` });
    const kra = all(await sets(declarationId, `spouse:${SPOUSE}`))[0];
    if (!kra) throw new Error('No KRA suggestion');
    const outcome = await acceptSuggestion(client, {
      declarationId,
      suggestionId: kra.id,
      ifMatch: await etagOf(declarationId),
      fields: kra.fields,
      applyToItemId: null,
    });
    if (outcome.status !== 'accepted') throw new Error(outcome.status);
    expect(outcome.itemId).toBe(SPOUSE);
    const household = await loadSection(client, declarationId, 'household');
    if (household.status !== 'ok') throw new Error(household.status);
    expect(household.section.contents.spouses).toMatchObject({
      items: [{ id: SPOUSE, kraPin: 'A006612874M' }],
    });

    await lookup(declarationId);
    const officerKra = all(await sets(declarationId)).find((each) => each.itemType === 'bio-tax');
    expect(
      await acceptSuggestion(client, {
        declarationId,
        suggestionId: officerKra?.id ?? '',
        ifMatch: await etagOf(declarationId),
        fields: officerKra?.fields ?? {},
        applyToItemId: null,
      }),
    ).toEqual({ status: 'rejected', code: 'no-target' });
  });
});

describe('dismissing and re-running (S5)', () => {
  it('records a dismissal and refuses to dismiss what was accepted', async () => {
    const { declarationId } = await start();
    await lookup(declarationId);
    const found = await sets(declarationId);
    const probox = byRegistration(found, 'KCA 123A');
    const dismissed = await dismissSuggestion(client, {
      declarationId,
      suggestionId: probox.id,
      reason: 'Sold in 2025',
    });
    expect(dismissed).toMatchObject({ status: 'dismissed', suggestion: { status: 'dismissed' } });

    const fielder = byRegistration(found, 'KDA 123X');
    await acceptSuggestion(client, {
      declarationId,
      suggestionId: fielder.id,
      ifMatch: await etagOf(declarationId),
      fields: fielder.fields,
      applyToItemId: null,
    });
    expect(await dismissSuggestion(client, { declarationId, suggestionId: fielder.id })).toEqual({
      status: 'already-accepted',
    });
  });

  it('supersedes new suggestions and keeps accepted and dismissed ones', async () => {
    const { declarationId } = await start();
    await lookup(declarationId);
    const found = await sets(declarationId);
    const probox = byRegistration(found, 'KCA 123A');
    const fielder = byRegistration(found, 'KDA 123X');
    await dismissSuggestion(client, { declarationId, suggestionId: probox.id });

    await lookup(declarationId, { systems: ['ntsa'] });
    const after = all(await sets(declarationId)).filter((each) => each.itemType === 'vehicle');
    expect(after.map((each) => [each.fields.registration, each.status])).toEqual([
      ['KCA 123A', 'dismissed'],
      ['KDA 123X', 'superseded'],
      ['KDA 123X', 'new'],
    ]);
    expect(after.at(-1)?.id).not.toBe(fielder.id);
  });
});

describe('listing', () => {
  it('narrows to a section and answers 404 for an unknown draft', async () => {
    const { declarationId } = await start();
    await lookup(declarationId);
    const bio = await listSuggestions(client, { declarationId, sectionKey: 'bio' });
    if (bio.status !== 'ok') throw new Error(bio.status);
    expect(bio.sets.map((set) => set.source)).toEqual(['kra']);
    expect(await listSuggestions(client, { declarationId: crypto.randomUUID() })).toEqual({
      status: 'not-found',
    });
  });
});

const documents = createClient<documentPaths>({
  baseUrl: 'http://documents.test',
  fetch: mockDocumentsFetch,
});

/** A vehicle in the officer's statement with `fileName` linked to it. */
async function attached(fileName: string) {
  const { declarationId, etag } = await start();
  const itemId = crypto.randomUUID();
  const saved = await saveSection(client, {
    declarationId,
    sectionKey: 'statement:officer',
    ifMatch: etag,
    contents: { assets: [{ id: itemId, type: 'vehicle', description: 'Car' }] },
  });
  if (saved.status !== 'saved') throw new Error(saved.status);
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
  const linked = await linkAttachment(client, {
    declarationId,
    sectionKey: 'statement:officer',
    itemId,
    uploadId: data.id,
  });
  if (linked.status !== 'linked') throw new Error(linked.status);
  return { declarationId, itemId, attachmentId: linked.attachment.id };
}

function extract(declarationId: string, attachmentId: string, idempotencyKey?: string) {
  return extractAttachment(client, {
    declarationId,
    attachmentId,
    documentKindHint: 'logbook',
    idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
  });
}

describe('reading a document (S6)', () => {
  it('answers a pending document set that a later read finds ready, read into the item', async () => {
    const { declarationId, attachmentId, itemId } = await attached('logbook-KCB782M.pdf');
    const started = await extract(declarationId, attachmentId);
    if (started.status !== 'started') throw new Error(started.status);
    expect(started.set).toMatchObject({
      source: 'document',
      status: 'pending',
      personKey: 'officer',
      suggestions: [],
      aiJobId: expect.any(String) as string,
      attachmentId,
      documentKind: 'logbook',
      reason: null,
    });

    const found = await sets(declarationId);
    const set = found.find((each) => each.id === started.set.id);
    expect(set?.status).toBe('ready');
    const [suggestion] = set?.suggestions ?? [];
    expect(suggestion).toMatchObject({
      sectionKey: 'statement:officer',
      itemType: 'vehicle',
      status: 'new',
      fields: {
        'details.registration': 'KCB 782M',
        'details.makeModel': 'Toyota Premio, 2015',
        description: 'Toyota Premio saloon',
        'value.kesCents': 95_000_000,
      },
      sourceRef: {
        attachmentId,
        documentKind: 'logbook',
        warnings: ['Page 3 could not be read.'],
      },
      confidence: 0.41,
      matchItemId: itemId,
    });
    expect(suggestion?.sourceRef.fields).toContainEqual({
      name: 'value.kesCents',
      confidence: 0.41,
      page: 2,
    });
  });

  it('replays a request with the same idempotency key', async () => {
    const { declarationId, attachmentId } = await attached('logbook.pdf');
    const key = crypto.randomUUID();
    const first = await extract(declarationId, attachmentId, key);
    const again = await extract(declarationId, attachmentId, key);
    if (first.status !== 'started' || again.status !== 'started') throw new Error('not started');
    expect(again.set.id).toBe(first.set.id);
  });

  it('adds the read item with a document source and its AI job', async () => {
    const { declarationId, attachmentId, itemId } = await attached('logbook.pdf');
    const started = await extract(declarationId, attachmentId);
    if (started.status !== 'started') throw new Error(started.status);
    const set = (await sets(declarationId)).find((each) => each.id === started.set.id);
    const suggestion = set?.suggestions[0];
    if (!suggestion) throw new Error('nothing read');
    const outcome = await acceptSuggestion(client, {
      declarationId,
      suggestionId: suggestion.id,
      ifMatch: await etagOf(declarationId),
      fields: { ...suggestion.fields, 'details.makeModel': 'Toyota Premio, 2016' },
      applyToItemId: itemId,
    });
    if (outcome.status !== 'accepted') throw new Error(outcome.status);
    const section = await loadSection(client, declarationId, 'statement:officer');
    if (section.status !== 'ok') throw new Error(section.status);
    expect(section.section.contents.assets).toContainEqual(
      expect.objectContaining({
        id: itemId,
        description: 'Car',
        details: { registration: 'KCB 782M', makeModel: 'Toyota Premio, 2016' },
        source: expect.objectContaining({
          kind: 'document',
          suggestionId: suggestion.id,
          aiJobId: started.set.aiJobId,
        }) as unknown,
      }),
    );
  });

  it('fails a document it cannot read', async () => {
    const { declarationId, attachmentId } = await attached('blurred-deed.pdf');
    const started = await extract(declarationId, attachmentId);
    if (started.status !== 'started') throw new Error(started.status);
    const set = (await sets(declarationId)).find((each) => each.id === started.set.id);
    expect(set).toMatchObject({ status: 'failed', reason: 'document-unreadable', suggestions: [] });
  });

  it('answers a not-enabled set for a Commission without AI', async () => {
    setExtractionEnabled(false);
    const { declarationId, attachmentId } = await attached('logbook.pdf');
    expect(await extract(declarationId, attachmentId)).toMatchObject({
      status: 'started',
      set: { status: 'not-enabled' },
    });
  });

  it('adds a reading as a new item, its amount typed', async () => {
    const { declarationId, attachmentId } = await attached('logbook.pdf');
    const started = await extract(declarationId, attachmentId);
    if (started.status !== 'started') throw new Error(started.status);
    const suggestion = (await sets(declarationId)).find((each) => each.id === started.set.id)
      ?.suggestions[0];
    if (!suggestion) throw new Error('nothing read');
    const outcome = await acceptSuggestion(client, {
      declarationId,
      suggestionId: suggestion.id,
      ifMatch: await etagOf(declarationId),
      fields: { ...suggestion.fields, 'value.kesCents': '90000000' },
      applyToItemId: null,
    });
    if (outcome.status !== 'accepted') throw new Error(outcome.status);
    const section = await loadSection(client, declarationId, 'statement:officer');
    if (section.status !== 'ok') throw new Error(section.status);
    expect(section.section.contents.assets).toContainEqual(
      expect.objectContaining({
        id: outcome.itemId,
        type: 'vehicle',
        value: { kesCents: 90_000_000 },
      }),
    );
  });

  it('answers 404 for an unknown attachment and refuses a missing kind', async () => {
    const { declarationId, attachmentId } = await attached('logbook.pdf');
    expect(await extract(declarationId, crypto.randomUUID())).toEqual({ status: 'not-found' });
    expect(
      await extractAttachment(client, {
        declarationId,
        attachmentId,
        documentKindHint: 'passport' as 'other',
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toEqual({ status: 'refused', code: null });
  });
});

describe('applyPatch', () => {
  const item: Item = {
    id: 'a1',
    type: 'vehicle',
    description: 'Our car',
    details: { registration: 'KCA123A' },
  };
  const vehicle = {
    itemType: 'vehicle',
    fields: { registration: 'KCA 123A', make: 'Toyota', model: 'Fielder', year: 2016 },
  };

  it('fills only the empty fields unless told to overwrite', () => {
    const patch = suggestionPatch(vehicle);
    expect(applyPatch(item, patch)).toEqual({
      ...item,
      details: { registration: 'KCA123A', makeModel: 'Toyota Fielder, 2016' },
    });
    expect(applyPatch(item, patch, true).description).toBe('Toyota Fielder');
  });
});
