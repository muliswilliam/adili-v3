import { describe, expect, it } from 'vitest';

import type { AiJob } from '../../src/ai-gateway/ai-gateway-client.js';
import {
  type DraftedParagraph,
  insertDraft,
  type Paragraph,
} from '../../src/national-reports/narrative.js';
import type { PatternCandidate } from '../../src/national-reports/candidates.js';
import {
  draftJobSections,
  type DraftOutcome,
  draftOutcomeOf,
  outcomeOf,
} from '../../src/national-reports/narrative-draft.js';
import type { NarrativeSection } from '../../src/national-reports/schema.js';

/**
 * S2 and S3 at the module seam: where an AI draft's paragraphs land in the narrative, and how a
 * gateway job's answer becomes the draft's outcome.
 */
describe('NCR narrative draft insertion (S2, S3)', () => {
  let next = 0;
  const newId = () => `new-${String((next += 1))}`;

  const stored = (
    id: string,
    section: NarrativeSection,
    position: number,
    aiDraft: boolean,
  ): Paragraph => ({
    id,
    section,
    position,
    text: `Paragraph ${id}.`,
    aiDraft,
    aggregateRefs: aiDraft ? ['national.filingRate'] : [],
    candidateIds: [],
  });

  const drafted = (section: NarrativeSection, text: string): DraftedParagraph => ({
    section,
    text,
    aggregateRefs: ['national.filed'],
    candidateIds: section === 'findings' ? ['non-reporting:jsc'] : [],
  });

  const shape = (paragraphs: readonly Paragraph[]) =>
    paragraphs.map((p) => [p.section, p.position, p.id, p.aiDraft]);

  it('S2: inserts every section of an `all` draft as AI-draft paragraphs citing their keys and candidates', () => {
    next = 0;
    const saved = insertDraft(
      [],
      [
        drafted('overview', 'Overview.'),
        drafted('findings', 'Finding one.'),
        drafted('findings', 'Finding two.'),
        drafted('recommendations', 'Recommendation.'),
      ],
      'all',
      false,
      newId,
    );

    expect(saved).toEqual([
      {
        id: 'new-1',
        section: 'overview',
        position: 0,
        text: 'Overview.',
        aiDraft: true,
        aggregateRefs: ['national.filed'],
        candidateIds: [],
      },
      {
        id: 'new-2',
        section: 'findings',
        position: 0,
        text: 'Finding one.',
        aiDraft: true,
        aggregateRefs: ['national.filed'],
        candidateIds: ['non-reporting:jsc'],
      },
      {
        id: 'new-3',
        section: 'findings',
        position: 1,
        text: 'Finding two.',
        aiDraft: true,
        aggregateRefs: ['national.filed'],
        candidateIds: ['non-reporting:jsc'],
      },
      {
        id: 'new-4',
        section: 'recommendations',
        position: 0,
        text: 'Recommendation.',
        aiDraft: true,
        aggregateRefs: ['national.filed'],
        candidateIds: [],
      },
    ]);
  });

  it('S3: a redraft of findings replaces only AI-draft paragraphs, where the first stood, keeping edited ones and other sections', () => {
    next = 0;
    const existing = [
      stored('o', 'overview', 0, true),
      stored('edited', 'findings', 0, false),
      stored('ai-1', 'findings', 1, true),
      stored('typed', 'findings', 2, false),
      stored('ai-2', 'findings', 3, true),
    ];

    const saved = insertDraft(
      existing,
      [drafted('findings', 'New one.'), drafted('findings', 'New two.')],
      'findings',
      false,
      newId,
    );

    expect(shape(saved)).toEqual([
      ['overview', 0, 'o', true],
      ['findings', 0, 'edited', false],
      ['findings', 1, 'new-1', true],
      ['findings', 2, 'new-2', true],
      ['findings', 3, 'typed', false],
    ]);
  });

  it("S3: with no AI-draft paragraph left the draft goes after the analyst's paragraphs", () => {
    next = 0;
    const saved = insertDraft(
      [stored('edited', 'findings', 0, false)],
      [drafted('findings', 'New.')],
      'findings',
      false,
      newId,
    );

    expect(shape(saved)).toEqual([
      ['findings', 0, 'edited', false],
      ['findings', 1, 'new-1', true],
    ]);
  });

  it('S3: replace all replaces the whole section', () => {
    next = 0;
    const saved = insertDraft(
      [
        stored('edited', 'findings', 0, false),
        stored('ai', 'findings', 1, true),
        stored('r', 'recommendations', 0, false),
      ],
      [drafted('findings', 'New.')],
      'findings',
      true,
      newId,
    );

    expect(shape(saved)).toEqual([
      ['findings', 0, 'new-1', true],
      ['recommendations', 0, 'r', false],
    ]);
  });

  it('drops drafted paragraphs of sections not asked for, and keeps a drafted paragraph one paragraph', () => {
    next = 0;
    const saved = insertDraft(
      [],
      [drafted('overview', 'Not asked for.'), drafted('findings', 'Line one.\n\nLine two.')],
      'findings',
      false,
      newId,
    );

    expect(saved.map((p) => [p.section, p.text])).toEqual([['findings', 'Line one.\nLine two.']]);
  });
});

describe('NCR narrative draft outcome', () => {
  const job = (fields: Partial<AiJob>): AiJob => ({
    id: '0199b000-0000-7000-8000-0000000000a1',
    task: 'narrate-compliance-report',
    subjectRef: 'national-report:x',
    status: 'queued',
    reason: null,
    promptVersion: 1,
    output: null,
    finishedAt: null,
    ...fields,
  });

  it('is drafting while the job is queued or running', () => {
    expect(outcomeOf(job({ status: 'queued' }))).toEqual({ status: 'drafting' });
    expect(outcomeOf(job({ status: 'running' }))).toEqual({ status: 'drafting' });
  });

  it('S2: a job that failed validation fails the draft with that reason', () => {
    expect(outcomeOf(job({ status: 'failed', reason: 'validation' }))).toEqual({
      status: 'failed',
      reason: 'validation',
    });
    expect(outcomeOf(job({ status: 'blocked', reason: 'policy' }))).toEqual({
      status: 'failed',
      reason: 'policy',
    });
  });

  it('fails a draft whose job the gateway no longer has, or whose output is outside the contract', () => {
    expect(outcomeOf(null)).toEqual({ status: 'failed', reason: 'missing' });
    expect(outcomeOf(job({ status: 'succeeded', output: { paragraphs: 'no' } }))).toEqual({
      status: 'failed',
      reason: 'invalid-output',
    });
  });

  it('a succeeded job gives its paragraphs', () => {
    const paragraphs = [drafted('findings', 'One.')];
    expect(outcomeOf(job({ status: 'succeeded', output: { label: {}, paragraphs } }))).toEqual({
      status: 'succeeded',
      paragraphs,
    });
  });

  function drafted(section: NarrativeSection, text: string): DraftedParagraph {
    return { section, text, aggregateRefs: ['national.filed'], candidateIds: [] };
  }
});

describe('NCR narrative draft jobs (S2)', () => {
  const drafted = (section: NarrativeSection, text: string): DraftedParagraph => ({
    section,
    text,
    aggregateRefs: ['national.filed'],
    candidateIds: [],
  });
  const candidate = { id: 'non-reporting:nlc:reported' } as PatternCandidate;

  it('asks the gateway for findings only with a candidate: with none, all is the overview and the recommendations', () => {
    expect(draftJobSections('all', [candidate])).toEqual(['all']);
    expect(draftJobSections('findings', [candidate])).toEqual(['findings']);
    expect(draftJobSections('all', [])).toEqual(['overview', 'recommendations']);
    expect(draftJobSections('overview', [])).toEqual(['overview']);
    expect(draftJobSections('recommendations', [])).toEqual(['recommendations']);
    expect(draftJobSections('findings', [])).toBeNull();
  });

  it('ends as its jobs do together: the first failure, drafting while any is, else every paragraph', () => {
    const overview = drafted('overview', 'Overview.');
    const recommendation = drafted('recommendations', 'Do.');
    const done = (paragraph: DraftedParagraph): DraftOutcome => ({
      status: 'succeeded',
      paragraphs: [paragraph],
    });

    expect(draftOutcomeOf([done(overview), done(recommendation)])).toEqual({
      status: 'succeeded',
      paragraphs: [overview, recommendation],
    });
    expect(draftOutcomeOf([done(overview), { status: 'drafting' }])).toEqual({
      status: 'drafting',
    });
    expect(
      draftOutcomeOf([{ status: 'drafting' }, { status: 'failed', reason: 'validation' }]),
    ).toEqual({ status: 'failed', reason: 'validation' });
  });
});
