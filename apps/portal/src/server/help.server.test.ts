import { beforeEach, describe, expect, it } from 'vitest';

import { HELP_TOPICS, topicQuery } from '../help/topics';
import { bearer, declarationsClient, PERSON, steppedUp } from '../test/declarant';
import { startDeclaration } from './declarations.server';
import {
  MOCK_OBLIGATIONS,
  resetDeclarationsMock,
  setAnswerPace,
  setAssistantMode,
} from './declarations/mock.server';
import { getCompletenessHints, searchHelp } from './assistant.server';
import { getHelpPassage } from './help.server';

const declarant = () => declarationsClient(bearer(PERSON));

beforeEach(() => {
  resetDeclarationsMock();
  setAnswerPace(0);
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

  it('is not found for an unknown passage', async () => {
    expect(
      await getHelpPassage(declarant(), { passageId: 'no-such-passage', language: 'en' }),
    ).toEqual({ status: 'not-found' });
  });
});

describe('summary hints (S5)', () => {
  async function draft() {
    const started = await startDeclaration(
      declarationsClient(steppedUp()),
      MOCK_OBLIGATIONS.initial,
    );
    if (started.status !== 'started') throw new Error(started.status);
    return started.declaration.id;
  }

  it("gives the summary's residuals, each with its deterministic text and an AI hint", async () => {
    const id = await draft();
    const result = await getCompletenessHints(declarationsClient(steppedUp()), id, 'en');
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.hints.status).toBe('ready');
    expect(result.hints.label).toMatchObject({
      aiAssisted: true,
      task: 'answer-declarant-question',
    });
    expect(result.hints.residuals.length).toBeGreaterThan(0);
    for (const residual of result.hints.residuals) expect(residual.message).not.toBe('');
    expect(result.hints.residuals.some((residual) => residual.hint)).toBe(true);
  });

  it('has the text only when the AI is unavailable', async () => {
    const id = await draft();
    setAssistantMode('unavailable');
    const result = await getCompletenessHints(declarationsClient(steppedUp()), id, 'en');
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.hints).toMatchObject({ status: 'unavailable', label: null });
    expect(result.hints.residuals.every((residual) => residual.hint === null)).toBe(true);
  });

  it("is not found for someone else's draft", async () => {
    const id = await draft();
    expect(
      await getCompletenessHints(
        declarationsClient(bearer({ person_id: '9d9d9d9d-0000-4000-8000-000000000009' })),
        id,
        'en',
      ),
    ).toEqual({ status: 'not-found' });
  });
});
