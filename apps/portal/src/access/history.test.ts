import { describe, expect, it } from 'vitest';

import { seededHistory } from '../components/access-history/testing';
import type { AccessHistoryEntry } from '../server/access/types';
import {
  countByFilter,
  filterEntries,
  pageOfEntries,
  toRegisterEntry,
  visibleEntries,
} from './history';

function entry(fields: Partial<AccessHistoryEntry>): AccessHistoryEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'notified',
    at: '2026-09-20T07:00:00Z',
    actor: null,
    summary: '',
    reference: 'ARQ-TSC-2026-0000052-I',
    subjectKind: 'access-request',
    subjectId: 'b7e10000-0000-4000-8000-000000000001',
    commission: { slug: 'tsc', name: 'Teachers Service Commission' },
    requester: 'Wanjiru Kamau',
    caseReference: null,
    outcome: null,
    certifiedCopy: null,
    ...fields,
  };
}

describe('Who accessed in the declarant’s words', () => {
  it('says who asked and that the Commission notified them', () => {
    const notified = entry({});
    expect(toRegisterEntry(notified, [notified], [])).toMatchObject({
      title: 'Wanjiru Kamau asked to see your declaration',
      actor: 'Notified by Teachers Service Commission',
      reference: 'ARQ-TSC-2026-0000052-I',
    });
  });

  it('names staff only by their role, and the outcome in the title', () => {
    const decided = entry({ kind: 'decided', outcome: 'partial-grant' });
    expect(toRegisterEntry(decided, [decided], [])).toMatchObject({
      title: 'Teachers Service Commission partially granted access',
      actor: 'Access officer, Teachers Service Commission',
      outcome: 'partial-grant',
    });
  });

  it('reads a law-enforcement grant by agency and case, never the officer', () => {
    const lea = entry({
      kind: 'decided',
      subjectKind: 'lea-request',
      requester: 'Asset Recovery Agency',
      caseReference: 'ARA/INV/118/2026',
      outcome: 'grant',
    });
    expect(toRegisterEntry(lea, [lea], [])).toMatchObject({
      title: 'Asset Recovery Agency was granted access',
      actor: 'Case ARA/INV/118/2026',
    });
    const downloaded = entry({
      kind: 'downloaded',
      subjectKind: 'lea-request',
      requester: 'Asset Recovery Agency',
    });
    expect(toRegisterEntry(downloaded, [downloaded], [])).toMatchObject({
      title: 'Asset Recovery Agency downloaded the package',
      actor: 'Law-enforcement agency',
    });
  });

  it('tells the first response, in its stance, from later edits', async () => {
    const { notices } = await seededHistory();
    const first = entry({
      kind: 'representations',
      subjectId: 'b7e10000-0000-4000-8000-000000000004',
      at: '2026-09-01T07:00:00Z',
    });
    const edit = { ...first, id: crypto.randomUUID(), at: '2026-09-02T07:00:00Z' };
    const all = [edit, first];
    expect(toRegisterEntry(first, all, notices).title).toBe('You objected');
    expect(toRegisterEntry(edit, all, notices).title).toBe('You edited your response');
    expect(toRegisterEntry(first, all, []).title).toBe('You responded');
  });

  it('reads a certified copy as the declarant’s own or their representative’s', () => {
    const copy = { id: 'c', declarationId: 'd', version: 2, documentId: null };
    const own = entry({
      kind: 'self-access',
      subjectKind: 'self-access',
      certifiedCopy: { ...copy, representativeName: null },
    });
    const theirs = entry({
      kind: 'self-access',
      subjectKind: 'self-access',
      certifiedCopy: { ...copy, representativeName: 'Mary Kennedy' },
    });
    expect(toRegisterEntry(own, [own], [])).toMatchObject({
      title: 'You obtained a certified copy',
      actor: 'You · version 2',
    });
    expect(toRegisterEntry(theirs, [theirs], [])).toMatchObject({
      title: 'Mary Kennedy obtained a certified copy for you',
      actor: 'Your representative',
    });
  });

  it('never shows steps before the declarant was notified', () => {
    const entries = [
      entry({ kind: 'received' }),
      entry({ kind: 'verified' }),
      entry({ kind: 'cannot-identify' }),
      entry({ kind: 'notified' }),
    ];
    expect(visibleEntries(entries).map((each) => each.kind)).toEqual(['notified']);
  });
});

describe('filters and pages', () => {
  it('counts and narrows entries by what they are about', async () => {
    const { entries } = await seededHistory();
    const counts = countByFilter(entries);
    expect(counts.all).toBe(entries.length);
    expect(counts['form-k'] + counts.lea + counts.copy).toBe(entries.length);
    expect(counts.lea).toBe(4);
    expect(counts.copy).toBe(2);
    expect(filterEntries(entries, 'lea').every((each) => each.subjectKind === 'lea-request')).toBe(
      true,
    );
  });

  it('clamps the page to the pages there are', () => {
    const items = Array.from({ length: 23 }, (_, index) => index);
    expect(pageOfEntries(items, 3)).toEqual({ page: 3, entries: [20, 21, 22] });
    expect(pageOfEntries(items, 9).page).toBe(3);
    expect(pageOfEntries([], 2)).toEqual({ page: 1, entries: [] });
  });
});
