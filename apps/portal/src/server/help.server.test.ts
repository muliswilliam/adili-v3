import { beforeEach, describe, expect, it } from 'vitest';

import { HELP_TOPICS, topicQuery } from '../help/topics';
import { bearer, declarationsClient, PERSON } from '../test/declarant';
import { searchHelp } from './assistant.server';
import { resetDeclarationsMock } from './declarations/mock.server';
import { getHelpPassage } from './help.server';

const declarant = () => declarationsClient(bearer(PERSON));

beforeEach(() => {
  resetDeclarationsMock();
});

describe('help pages: search (S12)', () => {
  it('finds passages with their citations, best first', async () => {
    const result = await searchHelp(declarant(), {
      q: 'joint',
      language: 'en',
      sectionKey: null,
      limit: 20,
    });
    if (result.status !== 'ok') throw new Error(result.status);
    const citations = result.passages.map((passage) => passage.citation);
    expect(citations).toContain('Help: Joint assets');
    expect(citations).toContain('AM 24');
  });

  it('browses a topic through the search endpoint, by the words its passages are tagged with', async () => {
    const result = await searchHelp(declarant(), {
      q: topicQuery('changes', 'en'),
      language: 'en',
      sectionKey: null,
      limit: 20,
    });
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.passages.map((passage) => passage.citation)).toEqual(
      expect.arrayContaining(['Act s.31(4)', 'Regs r.21']),
    );
  });

  it('has a Kiswahili query for every topic', () => {
    for (const topic of HELP_TOPICS) {
      expect(topicQuery(topic.key, 'sw').length).toBeGreaterThan(2);
      expect(topicQuery(topic.key, 'en').length).toBeGreaterThan(2);
    }
  });
});

describe('help pages: one passage', () => {
  it('reads a help article whole, in Kiswahili where it has it', async () => {
    const result = await getHelpPassage(declarant(), { passageId: 'help-joint', language: 'sw' });
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.passage).toMatchObject({
      id: 'help-joint',
      source: 'help',
      citation: 'Help: Joint assets',
      title: 'Mali ya pamoja',
      language: 'sw',
      commission: null,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    });
    expect(result.passage.text).toMatch(/^Ukimiliki mali pamoja/);
  });

  it('falls back to English for a passage without Swahili text', async () => {
    const result = await getHelpPassage(declarant(), { passageId: 'act-35-2', language: 'sw' });
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.passage).toMatchObject({ language: 'en', title: 'Clarification' });
  });

  it("names the Commission of a Commission's article", async () => {
    const result = await getHelpPassage(declarant(), { passageId: 'help-file', language: 'en' });
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.passage.commission).toMatchObject({ issuerCode: 'TSC' });
  });

  it('reads the wording in force on the day asked', async () => {
    const read = (date: string) =>
      declarant().GET('/v1/help/passages/{passageId}', {
        params: { path: { passageId: 'help-file' }, query: { language: 'en', date } },
      });
    expect((await read('2026-06-30')).response.status).toBe(404);
    expect((await read('2026-07-01')).data).toMatchObject({
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
    });
  });

  it('is not found for an unknown passage', async () => {
    expect(
      await getHelpPassage(declarant(), { passageId: 'no-such-passage', language: 'en' }),
    ).toEqual({ status: 'not-found' });
  });
});
